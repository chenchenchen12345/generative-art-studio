# My Generative Art

A collection of generative art sketches shaped entirely by live microphone (and optional MIDI) input — no manual toggles, sliders, or rule pickers. Play music (or make noise) and the art grows/moves/colors itself from that signal.

## Project structure

```
my-generative-art/
  index.html                                <- the photobooth: one page, one shared mic feed, all 5 sketches live in a tile wall, click a tile to focus it
  js/
    shared-audio.js                         <- the one audio graph: mic + gain boost + synth + MIDI + FFT/Amplitude + recording, used by everything in index.html
  sketches/
    sketch-cellular-automata.js             <- p5 instance-mode factory: Life-style cellular automaton
    sketch-slime-mold.js                    <- p5 instance-mode factory: slime mold growth simulation
    sketch-sound-grid.js                    <- p5 instance-mode factory: scrolling spectrum heatmap
    sketch-resonance-field.js               <- p5 instance-mode factory: Chladni plate (standing-wave sand patterns)
    sketch-neural-network.js                <- p5 instance-mode factory: live feedforward network, spectrum as input layer
  theme.css                                 <- shared site theme (colors, fonts, panel styles)
  audio-cellular-automata.html              <- legacy standalone page (own mic prompt), same sketch as above
  audio-slime-mold.html                     <- legacy standalone page (own mic + MIDI + recording UI)
  audio-sound-grid.html                     <- legacy standalone page
  audio-resonance-field.html                <- legacy standalone page
  README.md                                 <- this file
```

`index.html` is the primary way to use this project now: enable audio once and all five pieces react together off one mic feed, then click any square to step into it alone. The four legacy standalone `audio-*.html` pages still work (each grabs its own mic independently) but aren't linked from the photobooth — they're kept around for anyone who wants a single sketch in its own tab/window. (Neural Network only exists inside the photobooth — it was built directly on the shared-audio architecture, no standalone page for it.)

## Architecture

`js/shared-audio.js` builds one audio graph — mic (with AGC/noise-suppression disabled and an explicit gain boost, since raw mic signal is quieter than you'd expect), a small MIDI-driven synth, a shared FFT + Amplitude analyzer, and a `MediaRecorder` — and exposes it as a plain `AudioShared` object. Each file in `sketches/` is a p5 **instance-mode** factory function (e.g. `createSlimeMoldSketch(container)`) that mounts its own canvas into a container div and reads `AudioShared.fft` / `AudioShared.amp` / `AudioShared.knobValues` every frame, instead of requesting its own mic. This is what lets all five run at once off a single "Enable Audio" click. `index.html` creates the five sketch instances into grid tiles and handles the click-to-focus interaction purely with CSS (each canvas renders at a fixed resolution; focusing just scales its display size via `object-fit: contain`, no resize/reinit). The tile wall is a `flex-wrap` grid with `justify-content: center`, so it centers gracefully whether there are 4, 5, or N tiles — an incomplete last row just centers itself instead of leaving a gap.

### Adding another sketch

Write it as a new `sketches/sketch-*.js` instance-mode factory that reads off `AudioShared` (see the existing five for the pattern), then add a tile for it in `index.html`'s grid — no need to touch the audio graph or the layout CSS.

## Theme

All pages share one look, defined once in `theme.css`: a dark indigo background with a dot-grid texture, bold uppercase Space Mono type, and white-outlined panels/buttons/cards that invert on hover.

## How to run it

You don't need to install anything to just look at these — double-clicking any `.html` file will open it in your default browser. But for actual development (and for the microphone-based sketch to behave reliably), it's better to serve the folder through a local server rather than opening files directly from disk.

### In VS Code

1. Open this whole folder in VS Code: `File > Open Folder...` and select `my-generative-art`.
2. Install the **Live Server** extension (search "Live Server" by Ritwick Dey in the Extensions panel).
3. Right-click `index.html` in the file explorer and choose **"Open with Live Server."**
4. Your browser opens automatically at something like `http://127.0.0.1:5500` — click through the cards to explore each sketch.
5. Any time you edit and save a file, Live Server auto-refreshes the browser. This is the whole workflow — edit, save, see it change instantly.

Why Live Server instead of just double-clicking the file: some browser features (including microphone access in certain setups) behave more consistently when served over `http://` rather than opened as a raw `file://` path. It also just makes iterating faster.

## Notes

- All sketches use [p5.js](https://p5js.org/) (loaded from a CDN, no install needed) — it's essentially Processing for the browser.
- All sketches use **p5.sound** for microphone/FFT analysis. Nothing is recorded or sent anywhere; all analysis happens locally in your browser tab.
- No hardware (Raspberry Pi, Arduino, etc.) is required for any of this — everything here runs on a laptop with a browser and, optionally, a USB microphone.
