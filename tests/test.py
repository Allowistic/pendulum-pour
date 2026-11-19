import asyncio, sys, json, os, time, base64
from playwright.async_api import async_playwright

# python3 test.py out_dir [url]
async def run(out, url):
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"])
        W = int(os.environ.get('W', '1100')); H = int(os.environ.get('H', '700'))
        ctx = await b.new_context(viewport={"width": W, "height": H}, accept_downloads=True)
        pg = await ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        if url.startswith('file:'):
            await pg.route('http*://**', lambda r: (errs.append('BLOCKED ' + r.request.url), r.abort()))
        pg.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        t0 = time.time()
        await pg.goto(url, wait_until='load', timeout=180000)
        await pg.wait_for_timeout(2500)
        info = await pg.evaluate("({full: __pour.paint.full, N: __pour.paint.N, cans: __pour.rigs.length})")
        print('ready', round(time.time() - t0, 1), info, flush=True)
        await pg.evaluate("__pour.setPaused(true)")
        times = [float(x) for x in os.environ.get('TIMES', '8,20,40,70,110,160').split(',')]
        last = 0
        stats = []
        for t in times:
            t1 = time.time()
            await pg.evaluate(f"__pour.advance({t - last}, 1/60)")
            last = t
            await pg.wait_for_timeout(400)
            await pg.screenshot(path=f"{out}/scene_t{int(t):03d}.png")
            # a top-down picture of the canvas at this moment (the same render the background export uses)
            d = await pg.evaluate("__pour.exportDataUrl(700, 700)")
            open(f"{out}/top_t{int(t):03d}.png", 'wb').write(base64.b64decode(d.split(',')[1]))
            s = await pg.evaluate("""(() => ({ time: __pour.time, hue: __pour.hue, levels: __pour.rigs.map(r => +r.p.level.toFixed(3)), poured: __pour.rigs.map(r => +r.p.poured.toFixed(1)), alive: __pour.rigs.map(r => r.p.parcels.filter(q => q.alive).length) }))()""")
            print('t', t, s, round(time.time() - t1, 1), 's', flush=True)
            stats.append(s)
        # Export through the real button path: a download
        async with pg.expect_download() as dl:
            await pg.evaluate("document.getElementById('save').click()")
            await pg.wait_for_timeout(300)
            await pg.evaluate("document.querySelector('[data-size=desktop4k]').click()")
        d = await dl.value
        path = f"{out}/{d.suggested_filename}"
        await d.save_as(path)
        print('download', d.suggested_filename, os.path.getsize(path), flush=True)
        async with pg.expect_download() as dl2:
            await pg.evaluate("document.getElementById('save').click()")
            await pg.wait_for_timeout(300)
            await pg.evaluate("document.querySelector('[data-size=phone]').click()")
        d2 = await dl2.value
        path2 = f"{out}/{d2.suggested_filename}"
        await d2.save_as(path2)
        print('download', d2.suggested_filename, os.path.getsize(path2), flush=True)
        # Live background mode
        await pg.evaluate("__pour.setBackgroundMode(true)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{out}/live_background.png")
        await pg.evaluate("__pour.setBackgroundMode(false)")
        await pg.wait_for_timeout(500)
        print('ERRORS', json.dumps(errs, indent=1))
        json.dump({'stats': stats, 'errors': errs}, open(f"{out}/result.json", 'w'), indent=1)
        await b.close()

asyncio.run(run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'file:///home/sprite/pendulum-pour/dist/index.html?seed=7'))
