// ============================================================
// SHARED AUDIO GRAPH — one mic + one synth + one analyser,
// read by all four sketches at once so the whole grid reacts
// to the same live signal instead of each tile grabbing its
// own mic stream.
// ============================================================
// p5.sound objects (AudioIn, FFT, Gain, Oscillator, Envelope,
// Filter...) all attach to one page-wide audio context no matter
// how many p5 instances exist, so this module builds the graph
// once, outside of any sketch, and every sketch instance just
// reads AudioShared.fft / AudioShared.amp each frame.

const AudioShared = (() => {
  // a silent, canvas-less p5 instance purely so we have something
  // to call instance methods like userStartAudio()/getAudioContext()
  // on — p5.sound's own constructors (p5.AudioIn etc.) don't need one
  let bootstrap = new p5((p) => { p.setup = () => p.noCanvas(); });

  let mic, micBoost, fft, amp, mixBus;
  let synthFilter, synthGain;
  let synthVoices = [];
  const NUM_VOICES = 6;
  let MIC_GAIN = 6;

  let recordDest, mediaRecorderObj, recordedChunks = [];

  const knobSlots = ['FILTER CUTOFF', 'PLUCK LENGTH', 'TONE (WAVE)', 'SENSOR WIDTH+', 'GROWTH RATE+', 'HUE SHIFT+'];
  const knobCCMap = {};
  const knobValues = new Array(knobSlots.length).fill(0.5);

  const noteOnListeners = new Set();
  const onsetListeners = new Set();

  // spectral-flux onset detection + tempo tracking, computed once per
  // rendered frame here so every sketch reads the same onset/beat/
  // brightness signal instead of each re-deriving its own bass-diff hack
  let prevSpectrum = null;
  let fluxFloor = 2;
  let onsetPulse = 0;
  let lastOnsetTime = 0;
  const onsetIntervals = [];
  let bpm = 120;
  let beatPeriodMs = 500;
  let beatPhase = 0;
  let lastFrameTime = 0;
  let centroid = 0;

  class SynthVoice {
    constructor(filterNode) {
      this.osc = new p5.Oscillator('sawtooth');
      this.osc.amp(0);
      this.osc.disconnect();
      this.osc.connect(filterNode);
      this.osc.start();
      this.env = new p5.Envelope();
      this.env.setADSR(0.006, 0.12, 0.25, 0.4);
      this.env.setRange(0.5, 0);
      this.note = -1;
      this.active = false;
    }
    setWaveform(type) { this.osc.setType(type); }
    setRelease(r) { this.env.setADSR(0.006, 0.12, 0.25, r); }
    noteOn(note, velocity) {
      this.osc.freq(440 * Math.pow(2, (note - 69) / 12));
      this.env.setRange(0.12 + velocity * 0.55, 0);
      this.env.triggerAttack(this.osc);
      this.note = note;
      this.active = true;
    }
    noteOff(note) {
      if (this.note === note) {
        this.env.triggerRelease(this.osc);
        this.active = false;
      }
    }
  }

  function allocateVoice() {
    for (const v of synthVoices) if (!v.active) return v;
    return synthVoices[0];
  }

  function noteOnHandler(note, velocity) {
    const v = allocateVoice();
    v.noteOn(note, velocity);
    synthVoices.splice(synthVoices.indexOf(v), 1);
    synthVoices.push(v);
    for (const fn of noteOnListeners) fn(note, velocity);
  }

  function noteOffHandler(note) {
    for (const v of synthVoices) if (v.note === note && v.active) v.noteOff(note);
  }

  function applyKnobEffects() {
    if (!synthFilter) return;
    synthFilter.freq(200 + knobValues[0] * 5800);
    const release = 0.05 + knobValues[1] * 1.2;
    for (const v of synthVoices) v.setRelease(release);
    const waveType = knobValues[2] < 0.34 ? 'sine' : knobValues[2] < 0.67 ? 'triangle' : 'sawtooth';
    for (const v of synthVoices) v.setWaveform(waveType);
  }

  function handleCC(cc, value) {
    if (!(cc in knobCCMap)) {
      if (Object.keys(knobCCMap).length >= knobSlots.length) return;
      knobCCMap[cc] = Object.keys(knobCCMap).length;
      api._fireKnobsChange();
    }
    knobValues[knobCCMap[cc]] = value;
    applyKnobEffects();
  }

  function handleMIDIMessage(msg) {
    if (!api.ready) return;
    const [status, d1, d2] = msg.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) noteOnHandler(d1, d2 / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOffHandler(d1);
    else if (cmd === 0xb0) handleCC(d1, d2 / 127);
  }

  function attachMIDIInputs(access) {
    const names = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = handleMIDIMessage;
      names.push(input.name);
    });
    api.midiStatusText = names.length ? 'connected - ' + names.join(', ') : 'no device detected - plug one in';
    api._fireMidiStatusChange();
  }

  function initMIDI() {
    if (!navigator.requestMIDIAccess) {
      api.midiStatusText = 'Web MIDI not supported in this browser.';
      api._fireMidiStatusChange();
      return;
    }
    navigator.requestMIDIAccess().then((access) => {
      attachMIDIInputs(access);
      access.onstatechange = () => attachMIDIInputs(access);
    }).catch(() => {
      api.midiStatusText = 'MIDI access denied.';
      api._fireMidiStatusChange();
    });
  }

  function pickMimeType(hasVideo) {
    const candidates = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  function analysisTick(now) {
    if (!lastFrameTime) lastFrameTime = now;
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    if (api.ready && fft) {
      const spectrum = fft.analyze();

      if (prevSpectrum) {
        let flux = 0;
        for (let i = 0; i < spectrum.length; i++) {
          const d = spectrum[i] - prevSpectrum[i];
          if (d > 0) flux += d;
        }
        flux /= spectrum.length;

        fluxFloor += (flux - fluxFloor) * 0.02;
        const threshold = fluxFloor * 1.8 + 4;

        if (flux > threshold && now - lastOnsetTime > 120) {
          const interval = now - lastOnsetTime;
          lastOnsetTime = now;
          if (interval > 220 && interval < 1200) {
            onsetIntervals.push(interval);
            if (onsetIntervals.length > 8) onsetIntervals.shift();
            const sorted = [...onsetIntervals].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            bpm = Math.max(60, Math.min(180, 60000 / median));
            beatPeriodMs = 60000 / bpm;
          }
          onsetPulse = 1;
          beatPhase *= 0.5;
          const strength = Math.min(1, flux / (threshold + 1));
          for (const fn of onsetListeners) fn(strength);
        }
      }
      prevSpectrum = spectrum.slice();

      let weighted = 0, total = 0;
      for (let i = 0; i < spectrum.length; i++) { weighted += spectrum[i] * i; total += spectrum[i]; }
      const rawCentroid = total > 0.1 ? weighted / total / spectrum.length : 0;
      centroid += (rawCentroid - centroid) * 0.15;

      onsetPulse *= 0.88;
      beatPhase += dt / beatPeriodMs;
      beatPhase -= Math.floor(beatPhase);

      api.onset = onsetPulse;
      api.bpm = bpm;
      api.beatPhase = beatPhase;
      api.centroid = centroid;
    }

    requestAnimationFrame(analysisTick);
  }

  const api = {
    ready: false,
    midiStatusText: 'waiting for Start Audio...',
    isRecording: false,
    knobSlots,
    knobValues,
    fft: null,
    amp: null,

    // derived listening features, updated once per frame by analysisTick()
    onset: 0,       // 0-1 decaying pulse, fires on a detected spectral-flux transient
    bpm: 120,        // estimated tempo from onset spacing
    beatPhase: 0,    // 0-1 sawtooth synced to bpm, loosely phase-locked on each onset
    centroid: 0,     // 0-1 spectral centroid ("brightness" of the current timbre)

    _midiStatusListeners: new Set(),
    _knobsListeners: new Set(),
    onMidiStatusChange(fn) { this._midiStatusListeners.add(fn); },
    onKnobsChange(fn) { this._knobsListeners.add(fn); },
    onNoteOn(fn) { noteOnListeners.add(fn); },
    onOnset(fn) { onsetListeners.add(fn); },
    _fireMidiStatusChange() { for (const fn of this._midiStatusListeners) fn(this.midiStatusText); },
    _fireKnobsChange() { for (const fn of this._knobsListeners) fn(knobCCMap, knobSlots); },

    start(onReady, onError) {
      bootstrap.userStartAudio().then(() => {
        mic = new p5.AudioIn();
        const rawConstraints = {
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false
        };
        mic.start(() => {
          micBoost = new p5.Gain();
          micBoost.setInput(mic);
          micBoost.amp(MIC_GAIN);

          synthFilter = new p5.Filter('lowpass');
          synthFilter.freq(2200);
          synthFilter.res(3);
          synthGain = new p5.Gain();
          synthGain.setInput(synthFilter);
          synthGain.amp(0.9);
          synthGain.connect();
          for (let i = 0; i < NUM_VOICES; i++) synthVoices.push(new SynthVoice(synthFilter));

          mixBus = new p5.Gain();
          micBoost.connect(mixBus);
          synthGain.connect(mixBus);

          fft = new p5.FFT(0.4, 128);
          fft.setInput(mixBus);
          amp = new p5.Amplitude(0.25);
          amp.setInput(mixBus);
          this.fft = fft;
          this.amp = amp;

          const ctx = bootstrap.getAudioContext();
          recordDest = ctx.createMediaStreamDestination();
          mixBus.connect(recordDest);

          this.ready = true;
          initMIDI();
          if (onReady) onReady();
        }, (err) => {
          if (onError) onError(err);
        }, rawConstraints);
      });
    },

    setMicGain(v) {
      MIC_GAIN = v;
      if (micBoost) micBoost.amp(MIC_GAIN);
    },

    getMicGain() { return MIC_GAIN; },

    sampleRate() { return bootstrap.getAudioContext().sampleRate; },

    // pass a video-only MediaStream (e.g. canvas.captureStream(30)) to record
    // the art and the music together; omit it to fall back to audio-only
    toggleRecording(videoStream) {
      if (!this.ready || !recordDest) return;
      if (!this.isRecording) this._startRecording(videoStream); else this._stopRecording();
    },

    _startRecording(videoStream) {
      recordedChunks = [];
      const tracks = [...recordDest.stream.getAudioTracks()];
      if (videoStream) tracks.push(...videoStream.getVideoTracks());
      const combined = new MediaStream(tracks);
      const mimeType = pickMimeType(!!videoStream);
      mediaRecorderObj = mimeType ? new MediaRecorder(combined, { mimeType }) : new MediaRecorder(combined);
      mediaRecorderObj.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorderObj.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType || (videoStream ? 'video/webm' : 'audio/webm') });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toLocaleTimeString().replace(/:/g, '-');
        const name = 'photobooth-session-' + stamp + '.webm';

        // trigger a real browser download straight to Downloads instead of
        // leaving a link sitting on the page
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
      mediaRecorderObj.start();
      this.isRecording = true;
    },

    _stopRecording() {
      if (mediaRecorderObj && this.isRecording) {
        mediaRecorderObj.stop();
        this.isRecording = false;
      }
    }
  };

  requestAnimationFrame(analysisTick);

  return api;
})();
