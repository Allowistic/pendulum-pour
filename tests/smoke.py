import asyncio, sys, json
from playwright.async_api import async_playwright

async def run(url):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = await (await b.new_context(viewport={"width": 900, "height": 600})).new_page()
        pg.set_default_timeout(300000)
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await pg.goto(url, wait_until="load", timeout=120000)
        await pg.wait_for_timeout(2500)
        await pg.select_option("#cans", "3")
        await pg.select_option("#vessel", "five")
        await pg.evaluate("__pour.setPaused(true); __pour.settings.speed = 3")
        await pg.evaluate("__pour.rigs.forEach(r => r.p.toss(15, 0.5))")
        # one big slow step: many landings in a frame, more than one batch
        r = await pg.evaluate("""(() => { let most = 0; for (let k = 0; k < 40; k++) { __pour.advance(1/20, 1/20); most = Math.max(most, __pour.rigs.reduce((s, r) => s + r.p.landings.length, 0)); } return { most, cans: __pour.rigs.length, holes: __pour.rigs[0].p.vessel.holes, levels: __pour.rigs.map(r => +r.p.level.toFixed(3)) }; })()""")
        print("stress", r)
        top = await pg.evaluate("__pour.exportDataUrl(300, 300).length")
        print("export data url length", top)
        await pg.evaluate("document.getElementById('pause').click()")
        await pg.wait_for_timeout(2000)
        await pg.keyboard.press("b")
        await pg.wait_for_timeout(800)
        bg = await pg.evaluate("document.body.classList.contains('bg-mode')")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(300)
        print("bg mode toggled", bg, "exited", not await pg.evaluate("document.body.classList.contains('bg-mode')"))
        await pg.screenshot(path="/tmp/smoke.png")
        print("ERRORS", json.dumps([e for e in errs if "GPU stall" not in e]), "stall warnings", sum("GPU stall" in e for e in errs))
        await b.close()

asyncio.run(run(sys.argv[1]))
