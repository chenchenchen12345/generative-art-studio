// ============================================================
// SOUND GRID — instance-mode tile sketch
// ============================================================
// Mic spectrum split into log-spaced bands, scrolled top to
// bottom like a listening heatmap. Same layout/math as before,
// reading the shared analyser instead of its own mic. A MIDI note
// tags whichever row is being captured at that instant with a gold
// flash, so pressing a key leaves a visible streak scrolling down
// through the history instead of only nudging the spectrum values.
function createSoundGridSketch(container) {
  return new p5((p) => {
    const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
    const NUM_ROWS = DAY_LABELS.length;
    const NUM_COLS = 24;
    const SPACING = 22;
    const LEFT_MARGIN = 34;
    const TOP_MARGIN = 16;
    const RIGHT_MARGIN = 14;
    const BOTTOM_MARGIN = 26;
    const ROW_INTERVAL_MS = 150;

    let history = [];
    let lastRowTime = 0;
    let pendingFlash = 0;

    p.setup = () => {
      const gridW = (NUM_COLS - 1) * SPACING;
      const gridH = (NUM_ROWS - 1) * SPACING;
      const cnv = p.createCanvas(LEFT_MARGIN + gridW + RIGHT_MARGIN, TOP_MARGIN + gridH + BOTTOM_MARGIN);
      cnv.parent(container);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.textFont('monospace');
      p.background(0);

      AudioShared.onNoteOn((note, velocity) => {
        pendingFlash = Math.min(1, pendingFlash + 0.5 + velocity * 0.5);
      });
    };

    function logBinnedSpectrum(spectrum) {
      const sr = AudioShared.sampleRate();
      const nyquist = sr / 2;
      const minF = 40;
      const out = new Array(NUM_COLS).fill(0);
      for (let b = 0; b < NUM_COLS; b++) {
        const f0 = minF * Math.pow(nyquist / minF, b / NUM_COLS);
        const f1 = minF * Math.pow(nyquist / minF, (b + 1) / NUM_COLS);
        const i0 = p.constrain(Math.floor((f0 / nyquist) * spectrum.length), 0, spectrum.length - 1);
        const i1 = p.constrain(Math.max(i0 + 1, Math.floor((f1 / nyquist) * spectrum.length)), 0, spectrum.length);
        let sum = 0, count = 0;
        for (let i = i0; i < i1; i++) { sum += spectrum[i]; count++; }
        out[b] = count > 0 ? (sum / count) / 255 : 0;
      }
      return out;
    }

    p.draw = () => {
      if (!AudioShared.ready) return;

      const spectrum = AudioShared.fft.analyze();

      if (p.millis() - lastRowTime > ROW_INTERVAL_MS) {
        history.unshift({ v: logBinnedSpectrum(spectrum), flash: pendingFlash });
        pendingFlash *= 0.25;
        if (history.length > NUM_ROWS) history.pop();
        lastRowTime = p.millis();
      }

      p.background(0);
      drawGrid();
      drawLabels();
    };

    function drawGrid() {
      p.noStroke();
      for (let i = 0; i < NUM_ROWS; i++) {
        const row = history[i];
        const rowAlpha = p.map(i, 0, NUM_ROWS - 1, 100, 35);
        const y = TOP_MARGIN + i * SPACING;
        const flash = row ? row.flash : 0;
        for (let j = 0; j < NUM_COLS; j++) {
          const x = LEFT_MARGIN + j * SPACING;
          const v = row ? row.v[j] : 0;
          if (v > 0.03) {
            const d = p.map(v, 0, 1, 5, 24) + flash * 10;
            const hue = flash > 0.15 ? p.lerp(p.map(v, 0, 1, 0, 120), 46, flash) : p.map(v, 0, 1, 0, 120);
            const sat = flash > 0.15 ? p.lerp(85, 55, flash) : 85;
            p.drawingContext.shadowBlur = d * 0.8;
            p.drawingContext.shadowColor = `hsla(${hue}, 90%, 55%, 0.9)`;
            p.fill(hue, sat, 95, rowAlpha);
            p.circle(x, y, d);
            p.drawingContext.shadowBlur = 0;
          } else {
            p.fill(0, 0, 100, rowAlpha * 0.3);
            p.circle(x, y, 3.5);
          }
        }
      }
    }

    function drawLabels() {
      p.noStroke();
      p.fill(0, 0, 100, 55);
      p.textSize(10);
      p.textAlign(p.LEFT, p.CENTER);
      for (let i = 0; i < NUM_ROWS; i++) {
        p.text(DAY_LABELS[i], 4, TOP_MARGIN + i * SPACING);
      }
      p.textAlign(p.CENTER, p.TOP);
      p.textSize(9);
      const y = TOP_MARGIN + (NUM_ROWS - 1) * SPACING + 12;
      for (let j = 0; j < NUM_COLS; j += 2) {
        p.text(j + 1, LEFT_MARGIN + j * SPACING, y);
      }
    }
  });
}
