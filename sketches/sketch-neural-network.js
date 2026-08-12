// ============================================================
// NEURAL NETWORK — instance-mode tile sketch
// ============================================================
// A small feedforward network (fixed random weights, nothing is
// "trained") that never stops running a forward pass, once per
// frame. The input layer IS the mic spectrum — each input node
// reads one log-spaced frequency band, the same way sound-grid
// buckets its bands — so live audio is literally the network's
// input vector. Every later layer is a real weighted-sum + squash
// of the layer before it, smoothed frame to frame so activation
// visibly ripples left to right instead of snapping. A bass onset
// spikes a couple of random input nodes, like a hard transient
// briefly saturating a few input channels, and you can watch that
// surge propagate through the hidden layers a moment later. A MIDI
// note does the same thing directly (velocity-scaled hit count) and
// briefly boosts the forward-pass gain, so a played note visibly
// excites the whole network rather than only the input layer.
function createNeuralNetworkSketch(container) {
  return new p5((p) => {
    const layerSizes = [8, 12, 12, 8, 5];
    let layers = []; // layers[L] = [{x, y, activation}]
    let weights = []; // weights[L] = [prevSize][nextSize], from layer L to L+1
    let prevBass = 0;
    let noteFlash = 0;

    p.setup = () => {
      const cnv = p.createCanvas(640, 480);
      cnv.parent(container);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.background(240, 45, 6);

      const marginX = 60, marginY = 34;
      for (let L = 0; L < layerSizes.length; L++) {
        const n = layerSizes[L];
        const x = p.map(L, 0, layerSizes.length - 1, marginX, p.width - marginX);
        const nodes = [];
        for (let i = 0; i < n; i++) {
          const y = n === 1 ? p.height / 2 : p.map(i, 0, n - 1, marginY, p.height - marginY);
          nodes.push({ x, y, activation: 0 });
        }
        layers.push(nodes);
      }
      for (let L = 0; L < layerSizes.length - 1; L++) {
        const w = [];
        for (let i = 0; i < layerSizes[L]; i++) {
          const row = [];
          for (let j = 0; j < layerSizes[L + 1]; j++) row.push(p.random(-1, 1));
          w.push(row);
        }
        weights.push(w);
      }

      AudioShared.onNoteOn((note, velocity) => {
        noteFlash = Math.min(1, noteFlash + 0.4 + velocity * 0.6);
        const hits = 2 + Math.floor(velocity * 3);
        const inputLayer = layers[0];
        for (let k = 0; k < hits; k++) {
          inputLayer[Math.floor(p.random(inputLayer.length))].activation = 1;
        }
      });
    };

    function logBinnedSpectrum(spectrum, numBins) {
      const sr = AudioShared.sampleRate();
      const nyquist = sr / 2;
      const minF = 40;
      const out = new Array(numBins).fill(0);
      for (let b = 0; b < numBins; b++) {
        const f0 = minF * Math.pow(nyquist / minF, b / numBins);
        const f1 = minF * Math.pow(nyquist / minF, (b + 1) / numBins);
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
      const bass = AudioShared.fft.getEnergy('bass') / 255;
      const mid = AudioShared.fft.getEnergy('mid') / 255;
      const treble = AudioShared.fft.getEnergy('treble') / 255;
      const volume = AudioShared.amp.getLevel();

      // --- input layer = live spectrum, one band per input node ---
      const bands = logBinnedSpectrum(spectrum, layerSizes[0]);
      const inputLayer = layers[0];
      for (let i = 0; i < inputLayer.length; i++) {
        inputLayer[i].activation += (bands[i] - inputLayer[i].activation) * 0.5;
      }

      // a bass onset briefly saturates a couple of random input
      // channels, like a hard transient clipping a few bands
      const bassJump = bass - prevBass;
      if (bassJump > 0.15) {
        for (let k = 0; k < 2; k++) {
          inputLayer[Math.floor(p.random(inputLayer.length))].activation = 1;
        }
      }
      prevBass = bass;

      noteFlash *= 0.9;

      // --- forward pass: real weighted sum + squash per layer ---
      const gain = 1.2 + volume * 6 + mid * 1.5 + noteFlash * 3;
      for (let L = 1; L < layers.length; L++) {
        const prev = layers[L - 1];
        const cur = layers[L];
        const w = weights[L - 1];
        for (let j = 0; j < cur.length; j++) {
          let raw = 0;
          for (let i = 0; i < prev.length; i++) raw += prev[i].activation * w[i][j];
          raw /= Math.sqrt(prev.length);
          const squashed = Math.tanh(raw * gain);
          cur[j].activation += (squashed - cur[j].activation) * 0.18;
        }
      }

      p.background(240, 45, 6, 14);

      // --- edges: hue by sign (blue = positive, amber = negative), alpha by strength ---
      for (let L = 0; L < layers.length - 1; L++) {
        const prev = layers[L];
        const next = layers[L + 1];
        const w = weights[L];
        for (let i = 0; i < prev.length; i++) {
          const a = Math.abs(prev[i].activation);
          if (a < 0.04) continue;
          for (let j = 0; j < next.length; j++) {
            const strength = a * Math.abs(w[i][j]);
            if (strength < 0.03) continue;
            const positive = (prev[i].activation * w[i][j]) >= 0;
            const hue = positive ? 205 + treble * 40 : 30 + treble * 20;
            p.stroke(hue, 75, 90, p.constrain(strength * 90, 0, 85));
            p.strokeWeight(p.constrain(strength * 3, 0.4, 3));
            p.line(prev[i].x, prev[i].y, next[j].x, next[j].y);
          }
        }
      }

      // --- nodes: brighter/bigger when firing, hue drifts across layers ---
      p.noStroke();
      for (let L = 0; L < layers.length; L++) {
        const hueBase = p.map(L, 0, layers.length - 1, 195, 280);
        for (const node of layers[L]) {
          const mag = Math.abs(node.activation);
          const r = 5 + mag * 11;
          const hue = (hueBase + node.activation * 20 + 360) % 360;
          const bri = 35 + mag * 60;
          p.drawingContext.shadowBlur = 4 + mag * 16;
          p.drawingContext.shadowColor = `hsla(${hue}, 90%, 60%, 0.9)`;
          p.fill(hue, 70, bri);
          p.circle(node.x, node.y, r);
          p.drawingContext.shadowBlur = 0;
        }
      }
    };
  });
}
