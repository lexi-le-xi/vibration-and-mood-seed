// Each emotional state has its own voice; voices crossfade by state weight:
//   binaural beat — left/right frequency difference = target brainwave frequency (needs headphones)
//   isochronic    — one tone amplitude-pulsed at the target frequency (works on speakers)
//   pad           — a soft sustained chord whose volume follows the 0.1 Hz breathing guide
//   brown noise   — a wind- or wave-like breath
//   solfeggio     — pure sine tones (396–963 Hz), each slowly swelling in and out at its own pace

import { CONFIG } from './config.js';
import { STATES } from './emotion.js';

const TAU = Math.PI * 2;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.level = 0;
  }

  async start() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.master.connect(comp);
    comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    // High-resolution analyser (≈3 Hz per bin) so the debug panel can tell 396 from 417 Hz
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 16384;
    this.meter.smoothingTimeConstant = 0.6;
    comp.connect(this.meter);
    this.meterBuf = new Float32Array(this.meter.frequencyBinCount);

    // Breathing LFO: the visuals read the same clock so sound and plants breathe together
    this.breathT0 = ctx.currentTime + 0.1;
    this.breath = ctx.createOscillator();
    this.breath.frequency.value = CONFIG.breathHz;
    this.breath.start(this.breathT0);

    this.noiseBuf = this.makeNoise(4);
    this.voices = {};
    this.tones = [];
    for (const s of STATES) this.voices[s] = this.makeVoice(CONFIG.states[s], s);
    this.master.gain.setTargetAtTime(CONFIG.audio.master, ctx.currentTime, 2);
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  osc(f, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    return o;
  }

  makeVoice(s, key) {
    const ctx = this.ctx;
    const mode = CONFIG.audio.mode;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    if (mode !== 'isochronic') {
      const g = ctx.createGain();
      g.gain.value = s.binaural.gain;
      g.connect(out);
      [[s.binaural.carrier, -1], [s.binaural.carrier + s.beat, 1]].forEach(([f, pan]) => {
        const p = new StereoPannerNode(ctx, { pan });
        this.osc(f).connect(p);
        p.connect(g);
      });
    }

    if (mode !== 'binaural') {
      const amp = ctx.createGain();
      amp.gain.value = 1 - s.iso.depth / 2;
      const depth = ctx.createGain();
      depth.gain.value = s.iso.depth / 2;
      this.osc(s.beat).connect(depth);
      depth.connect(amp.gain);
      const g = ctx.createGain();
      g.gain.value = s.iso.gain;
      this.osc(s.iso.carrier).connect(amp);
      amp.connect(g);
      g.connect(out);
    }

    // Solfeggio tones: each one fades in and out on its own slow cycle (20–40 s),
    // so they surface one after another like singing bowls instead of a constant cluster
    if (s.solfeggio?.length) {
      const sg = ctx.createGain();
      sg.gain.value = CONFIG.audio.solfeggioGain;
      sg.connect(out);
      s.solfeggio.forEach((f, i) => {
        const g = ctx.createGain();
        const floor = CONFIG.audio.solfeggioFloor;
        g.gain.value = (1 + floor) / 2;
        const swell = ctx.createGain();
        swell.gain.value = (1 - floor) / 2;
        const swellHz = 0.025 + 0.012 * i + Math.random() * 0.008;
        this.tones.push({ f, state: key, swellHz, t0: ctx.currentTime });
        this.osc(swellHz).connect(swell);
        swell.connect(g.gain);
        const p = new StereoPannerNode(ctx, { pan: (i % 2 ? 0.5 : -0.5) * (i ? 1 : 0.4) });
        this.osc(f).connect(g);
        g.connect(p);
        p.connect(sg);
      });
    }

    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: s.pad.cutoff, Q: 0.5 });
    const pg = ctx.createGain();
    pg.gain.value = s.pad.gain * 0.65;
    const pb = ctx.createGain();
    pb.gain.value = s.pad.gain * 0.35;
    this.breath.connect(pb);
    pb.connect(pg.gain);
    s.pad.ratios.forEach((r, i) => {
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1.5);
      for (const det of [-1, 1]) {
        const p = new StereoPannerNode(ctx, { pan: det * 0.4 });
        this.osc(s.pad.root * r * (1 + det * 0.0015), s.pad.type).connect(p);
        p.connect(g);
      }
      g.connect(pg);
    });
    pg.connect(lp);
    lp.connect(out);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(0, Math.random() * 3);
    const nf = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: s.noise.cutoff });
    const ng = ctx.createGain();
    ng.gain.value = s.noise.gain * 0.5;
    const nb = ctx.createGain();
    nb.gain.value = s.noise.gain * 0.5;
    this.breath.connect(nb);
    nb.connect(ng.gain);
    src.connect(nf);
    nf.connect(ng);
    ng.connect(out);

    return { out };
  }

  setWeights(w, present) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const s of STATES) {
      const v = present ? w[s] : s === 'calm' ? CONFIG.audio.idleLevel : 0;
      this.voices[s].out.gain.setTargetAtTime(v, now, 0.6);
    }
  }

  // Current loudness (0..1) of every Solfeggio tone, so the plants can follow the sound.
  // The swell envelope is computed from the same clock as the oscillator that drives it.
  toneLevels(weights, present) {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    return this.tones.map((tn) => {
      const floor = CONFIG.audio.solfeggioFloor;
      const env = (1 + floor) / 2 + ((1 - floor) / 2) * Math.sin(2 * Math.PI * tn.swellHz * (now - tn.t0));
      const w = present ? weights[tn.state] : tn.state === 'calm' ? CONFIG.audio.idleLevel : 0;
      return { f: tn.f, state: tn.state, level: env * w };
    });
  }

  // Measured output level (dB) at each Solfeggio frequency — what is actually coming out of the speakers
  toneMeter() {
    if (!this.meter) return [];
    this.meter.getFloatFrequencyData(this.meterBuf);
    const hz = this.ctx.sampleRate / this.meter.fftSize;
    return this.tones.map((tn) => {
      let db = -Infinity;
      for (let i = Math.floor((tn.f - 4) / hz); i <= Math.ceil((tn.f + 4) / hz); i++) db = Math.max(db, this.meterBuf[i]);
      return { f: tn.f, state: tn.state, db };
    });
  }

  // Breathing phase (radians); plants expand while sin > 0
  breathAngle() {
    const t = this.ctx ? this.ctx.currentTime - this.breathT0 : performance.now() / 1000;
    return TAU * CONFIG.breathHz * t;
  }

  energy() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freq);
    let sum = 0;
    for (let i = 2; i < 60; i++) sum += this.freq[i];
    return sum / 58 / 255;
  }

  toggleMute() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : CONFIG.audio.master, this.ctx.currentTime, 0.3);
  }
}
