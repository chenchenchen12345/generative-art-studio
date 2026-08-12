// ============================================================
// RESONANCE FIELD — instance-mode tile sketch
// ============================================================
// Chladni-plate grain simulation, same math as before, reading
// the shared analyser instead of its own mic. A MIDI note pulls
// the plate's mode numbers directly toward that note's pitch for
// a moment (higher notes -> more complex pattern), on top of the
// existing audio-peak-driven mode and bass-onset agitation kick.
function createResonanceFieldSketch(container) {
  return new p5((p) => {
    const NUM_GRAINS = 3000;
    let grains = [];

    let smoothedPitchMode = 3;
    let smoothedOffset = 2;
    let smoothedVolume = 0;
    let prevBass = 0;
    let kick = 0;
    let noteModeTarget = 3;
    let noteModePull = 0;

    p.setup = () => {
      const cnv = p.createCanvas(640, 640);
      cnv.parent(container);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.background(235, 40, 5);
      for (let i = 0; i < NUM_GRAINS; i++) {
        grains.push({ x: p.random(-1, 1), y: p.random(-1, 1) });
      }

      AudioShared.onNoteOn((note, velocity) => {
        const t = p.constrain(p.map(note, 36, 84, 0, 1), 0, 1);
        noteModeTarget = p.lerp(2, 10, t);
        noteModePull = 1;
        kick = Math.min(1, kick + 0.4 + velocity * 0.6);
      });
    };

    function chladni(x, y, n, m) {
      return p.cos(n * p.PI * x) * p.cos(m * p.PI * y) - p.cos(m * p.PI * x) * p.cos(n * p.PI * y);
    }

    p.draw = () => {
      if (!AudioShared.ready) return;

      const spectrum = AudioShared.fft.analyze();
      const bass = AudioShared.fft.getEnergy('bass') / 255;
      const treble = AudioShared.fft.getEnergy('treble') / 255;
      const volume = AudioShared.amp.getLevel();

      const sr = AudioShared.sampleRate();
      const nyquist = sr / 2;
      const loBin = Math.floor((80 / nyquist) * spectrum.length);
      const hiBin = Math.floor((2000 / nyquist) * spectrum.length);
      let peakBin = loBin, peakVal = 0;
      for (let i = loBin; i <= hiBin; i++) {
        if (spectrum[i] > peakVal) { peakVal = spectrum[i]; peakBin = i; }
      }
      const peakFreq = (peakBin / spectrum.length) * nyquist;
      const normPeak = peakVal / 255;

      if (normPeak > 0.12) {
        const t = p.constrain(Math.log(peakFreq / 80) / Math.log(2000 / 80), 0, 1);
        const targetMode = p.lerp(2, 10, t);
        smoothedPitchMode += (targetMode - smoothedPitchMode) * 0.035;
      } else {
        smoothedPitchMode += (3 - smoothedPitchMode) * 0.008;
      }
      noteModePull *= 0.94;
      if (noteModePull > 0.02) {
        smoothedPitchMode += (noteModeTarget - smoothedPitchMode) * 0.12 * noteModePull;
      }
      const targetOffset = 1.5 + treble * 5;
      smoothedOffset += (targetOffset - smoothedOffset) * 0.05;
      smoothedVolume += (volume - smoothedVolume) * 0.15;

      const n = smoothedPitchMode;
      const m = n + smoothedOffset;

      kick *= 0.88;
      const bassJump = bass - prevBass;
      if (bassJump > 0.18) kick = Math.min(1, kick + bassJump * 1.6);
      prevBass = bass;

      const agitation = p.constrain(Math.pow(smoothedVolume * 6, 0.6), 0, 1.4) + kick * 0.9;

      p.blendMode(p.BLEND);
      p.background(235, 40, 5, 10);

      p.blendMode(p.ADD);
      const hue = p.map(n, 2, 10, 195, 330);
      p.strokeWeight(2.2);
      for (const g of grains) {
        const stepSize = 0.006 + agitation * 0.05;
        const nx = p.constrain(g.x + p.random(-stepSize, stepSize), -1, 1);
        const ny = p.constrain(g.y + p.random(-stepSize, stepSize), -1, 1);
        const curV = Math.abs(chladni(g.x, g.y, n, m));
        const newV = Math.abs(chladni(nx, ny, n, m));
        const acceptChance = 0.02 + agitation * 0.22;
        if (newV < curV || p.random() < acceptChance) {
          g.x = nx; g.y = ny;
        }
        const bri = 55 + (1 - p.constrain(curV, 0, 1)) * 20 + agitation * 18;
        p.stroke(hue, 85, bri, 70);
        p.point(p.map(g.x, -1, 1, 0, p.width), p.map(g.y, -1, 1, 0, p.height));
      }
      p.blendMode(p.BLEND);
    };
  });
}
