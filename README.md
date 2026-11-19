# Pendulum Pour

A paint can swinging on a rope over a canvas. Throw it and it draws a spirograph in poured paint. In this build each can holds a stack of colours that run out one after another while the whole palette drifts round the colour wheel, so the painting keeps changing colour as it builds up. The canvas can be saved as a wallpaper-sized PNG or run full screen as a live background.

**Live:** https://allowistic.github.io/pendulum-pour/

`index.html` is the whole thing in one file. It works offline: download it and open it in a browser.

## Based on

["Pendulum"](https://github.com/acher249/codevember-2026/tree/main/18-pendulum), Day 18 of Adam Chernick's [Codevember 2026](https://github.com/acher249/codevember-2026) ([original live demo](https://adamwebsite.com/codevember/18-pendulum/)), MIT License. It was shared on X by [@ibrews](https://x.com/ibrews/status/2123152750683021784).

Ported from the original source:

- `src/pendulum.ts`: the spherical pendulum (rope kept on a sphere round the pivot, air drag), the paint leaving the hole by Torricelli's law, and the falling parcels of paint. Almost line for line, plus a pivot per can, a colour per parcel and an automatic toss.
- `src/paint.ts`: the paint film on the canvas: landings spread along the way they were moving, flow that only runs past the paint's yield step and runs faster the thicker it is, wet-on-wet mixing, dry paint taking a new layer on top, and drying. The original runs as WebGPU compute shaders (three/tsl); here the same model runs as WebGL2 fragment passes on float textures, so it works in browsers without WebGPU, including the Quest browser.
- `src/canvas.ts`: drawing the paint with relief, wet gloss drying to satin and the bare canvas weave, plus the even "snapshot" lighting the original uses when it saves a painting.

The original's studio (room, windows, music, floor spills) isn't included. This build has a simple floor, a beam and a canvas on a turntable base.

## Added in this build

- **Stacked pour.** Each can is filled with 1 to 8 layers of colour from the palette. As it pours, the colour leaving the hole moves down through the stack, one layer every few seconds of pouring, with the end of each layer blending into the next, then around again. With two or three cans, each starts at a different place in the palette.
- **Colour shift over time.** The palette slowly rotates around the colour wheel (0 to 3 turns a minute), so later passes of the swing lay new colours over earlier ones.
- **Controls:** layers per can, palette (Spray fade, Studio from the original, Sunset, Ocean, Neon, Earth), layer length, colour shift speed, 1 to 3 cans, vessel (can, 3-hole or 5-hole bucket, slot), canvas colour, speed, auto-pour, pause, reset canvas and throw. A strip shows each can's stack and marks the layer pouring now. Settings are remembered.
- **Save background.** Renders the canvas straight down, evenly lit, cropped to fill the picture, and downloads a PNG at Phone (1170 x 2532), Desktop 4K (3840 x 2160), Desktop HD (1920 x 1080), Square (2048 x 2048) or the current window size. The picture is rendered fresh at that size, not scaled up from the screen.
- **Live background.** A full-screen, top-down view of the canvas with the controls hidden while it keeps pouring. Press B or the button to enter, Esc to leave. Open `index.html?background=1` to start in this mode, for example as a browser start page or an embedded background.

Keys: T throw, Space pause, R reset canvas, B live background. Drag a can to pull it back and let go to throw it. Drag anywhere else to orbit.

URL options: `?background=1` starts in live background mode, `?quality=low` or `?quality=high` sets the paint grid (288, 448 by default, or 640 columns across; phones and the Quest use 288), and `?seed=` makes the automatic throws repeatable.

## Building

```
npm install
npm run build   # builds source.html + src/ into one self-contained index.html
```

The source is in `src/` and `source.html`. `tests/` holds the headless Chromium checks used before publishing.

## License

MIT. See `LICENSE`. Original code copyright (c) 2026 Adam Chernick. Modifications copyright (c) 2026 Vincent Strader. three.js is MIT, copyright the three.js authors.
