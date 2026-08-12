// ============================================================
// AUDIO-REACTIVE SLIME MOLD — instance-mode tile sketch
// ============================================================
// Same growing-plasmodium mechanic as before: agents bud off the
// growing edge and steer toward the brightest existing trail, so
// heavily-walked paths thicken into veins. Volume/bass shape agent
// behavior continuously; growth bursts come from the shared onset
// detector (real spectral-flux transients, not a bespoke bass-diff
// threshold) and from MIDI notes on the shared synth. The colony's
// breathing pulse is locked to the shared tempo estimate's beat
// phase instead of its own free-running clock, so growth visibly
// pulses in time with the music. Knob slots 4-6 (once assigned)
// nudge sensor width, growth rate, and hue — read straight off the
// shared audio module so any MIDI controller affects this sketch
// whether or not it's the one currently in focus.
function createSlimeMoldSketch(container) {
  return new p5((p) => {
    let molds = [];
    const num = 4000;
    let activeCount = 0;

    let bass = 0, mid = 0, treble = 0, volume = 0;
    let sensorAngle = 30, sensorDist = 15, turnAngle = 30, stepSize = 1;
    let baseHue = 190;

    let growthEnergy = 0;
    let breathe = 0;
    let pulseFlash = 0;

    function boost(v, exp) { return Math.pow(p.constrain(v, 0, 1), exp); }

    p.setup = () => {
      const cnv = p.createCanvas(640, 480);
      cnv.parent(container);
      p.pixelDensity(1);
      p.angleMode(p.DEGREES);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.background(0, 0, 0);

      for (let i = 0; i < num; i++) molds[i] = new Mold();
      seedColony();

      AudioShared.onNoteOn((note, velocity) => {
        pulseFlash = Math.min(1, pulseFlash + 0.35 + velocity * 0.55);
        growColony(Math.floor(p.map(velocity, 0, 1, 10, 90, true)));
      });

      AudioShared.onOnset((strength) => {
        pulseFlash = Math.min(1, pulseFlash + strength * 0.7);
        growColony(Math.floor(p.map(strength, 0, 1, 10, 70, true)));
      });
    };

    function seedColony() {
      const cx = p.width / 2, cy = p.height / 2;
      const spots = [
        { x: cx, y: cy },
        { x: cx + p.random(-24, 24), y: cy + p.random(-24, 24) },
        { x: cx + p.random(-24, 24), y: cy + p.random(-24, 24) }
      ];
      const initial = 24;
      for (let i = 0; i < initial; i++) {
        const s = spots[i % spots.length];
        molds[activeCount].spawnAt(s.x + p.random(-5, 5), s.y + p.random(-5, 5), p.random(360));
        activeCount++;
      }
    }

    function growColony(n) {
      for (let k = 0; k < n && activeCount < num; k++) {
        let parentIdx;
        if (activeCount > 60) {
          const recentSpan = Math.max(30, Math.floor(activeCount * 0.4));
          parentIdx = activeCount - 1 - Math.floor(p.random(recentSpan));
        } else {
          parentIdx = Math.floor(p.random(activeCount));
        }
        parentIdx = p.constrain(parentIdx, 0, activeCount - 1);
        const parent = molds[parentIdx];
        const branchHeading = parent.heading + p.random(-55, 55);
        const dist = p.random(2, 6);
        const nx = ((parent.x + p.cos(branchHeading) * dist) % p.width + p.width) % p.width;
        const ny = ((parent.y + p.sin(branchHeading) * dist) % p.height + p.height) % p.height;
        molds[activeCount].spawnAt(nx, ny, branchHeading);
        activeCount++;
      }
    }

    p.draw = () => {
      if (!AudioShared.ready) return;

      AudioShared.fft.analyze();
      bass = AudioShared.fft.getEnergy('bass') / 255;
      mid = AudioShared.fft.getEnergy('mid') / 255;
      treble = AudioShared.fft.getEnergy('treble') / 255;
      volume = AudioShared.amp.getLevel();

      const knobValues = AudioShared.knobValues;

      sensorAngle = 15 + boost(mid, 0.55) * 150;
      sensorDist = 4 + boost(treble, 0.55) * 70;
      turnAngle = 12 + boost(bass, 0.55) * 130;
      stepSize = 0.35 + boost(volume, 0.5) * 11;
      baseHue = (185 + boost(mid, 0.6) * 150) % 360;

      sensorAngle += (knobValues[3] - 0.5) * 100;
      growthEnergy += Math.max(0, knobValues[4] - 0.5) * 0.5;
      baseHue = (baseHue + (knobValues[5] - 0.5) * 140 + 360) % 360;

      breathe = p.sin(AudioShared.beatPhase * 360) * 0.5 + 0.5;
      stepSize *= 0.8 + breathe * 0.35;

      pulseFlash *= 0.85;

      growthEnergy += boost(volume, 0.5) * 0.9 + boost(bass, 0.6) * 0.6;
      while (growthEnergy > 1 && activeCount < num) {
        growColony(Math.floor(p.random(2, 7)));
        growthEnergy -= 1;
      }

      const fadeAlpha = p.constrain(p.map(boost(volume, 0.5), 0, 1, 13, 2, true), 2, 13);
      p.background(0, 0, 0, fadeAlpha);

      p.loadPixels();
      for (let i = 0; i < activeCount; i++) molds[i].update();
      for (let i = 0; i < activeCount; i++) molds[i].display();
    };

    class Mold {
      constructor() { this.x = 0; this.y = 0; this.heading = 0; }

      spawnAt(x, y, heading) { this.x = x; this.y = y; this.heading = heading; }

      sense(angleOffset) {
        const a = this.heading + angleOffset;
        let sx = Math.floor(this.x + p.cos(a) * sensorDist);
        let sy = Math.floor(this.y + p.sin(a) * sensorDist);
        sx = ((sx % p.width) + p.width) % p.width;
        sy = ((sy % p.height) + p.height) % p.height;
        const idx = 4 * (sy * p.width + sx);
        return p.pixels[idx];
      }

      update() {
        const front = this.sense(0);
        const left = this.sense(sensorAngle);
        const right = this.sense(-sensorAngle);

        if (front >= left && front >= right) {
          this.heading += p.random(-4, 4);
        } else if (left > right) {
          this.heading += turnAngle;
        } else if (right > left) {
          this.heading -= turnAngle;
        } else {
          this.heading += p.random() < 0.5 ? turnAngle : -turnAngle;
        }

        this.x += stepSize * p.cos(this.heading);
        this.y += stepSize * p.sin(this.heading);

        this.x = ((this.x % p.width) + p.width) % p.width;
        this.y = ((this.y % p.height) + p.height) % p.height;
      }

      display() {
        const sx = Math.floor(((this.x % p.width) + p.width) % p.width);
        const sy = Math.floor(((this.y % p.height) + p.height) % p.height);
        const local = p.pixels[4 * (sy * p.width + sx)];

        const hue = (baseHue + treble * 160 + p.frameCount * 0.2) % 360;
        const sat = p.constrain(55 + bass * 40, 0, 100);
        const bri = p.constrain(50 + boost(volume, 0.5) * 45 + pulseFlash * 45, 0, 100);
        const w = p.map(local, 0, 255, 1, 2.6) * (0.8 + breathe * 0.5);

        p.stroke(hue, sat, bri, 92);
        p.strokeWeight(w);
        p.point(this.x, this.y);
      }
    }
  });
}
