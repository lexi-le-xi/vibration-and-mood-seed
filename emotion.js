// Infers an emotional state by fusing two signals:
//   body — 33 MediaPipe pose landmarks (shrinking, guarding the face, shrugging, fidgeting, startle)
//   face — 52 MediaPipe blendshapes (raised brows, wide eyes, pressed lips, frowning, smiling)
// These are heuristics drawn from body-language and FACS research, not a clinical
// diagnosis. All thresholds live in config.js and can be tuned live with the debug panel (D key).

import { CONFIG } from './config.js';

export const STATES = ['fear', 'tension', 'calm'];

const C = CONFIG.emotion;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mapR = (v, r) => clamp01((v - r[0]) / (r[1] - r[0]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ema = (prev, v, dt, tau) => prev + (v - prev) * (1 - Math.exp(-dt / tau));
const vis = (p) => (p ? p.visibility ?? 1 : 0);

export class EmotionAnalyzer {
  constructor() {
    this.weights = { fear: 0, tension: 0, calm: 1 };
    this.target = { ...this.weights };
    this.state = 'calm';
    this.present = false;
    this.force = null; // keys 1/2/3 force a state (demo / debugging)
    this.lastSeen = -1e9;
    this.cand = null;
    this.candT = 0;
    this.resetPerson();
  }

  resetPerson() {
    this.sm = null;
    this.prevT = null;
    this.prevS = null;
    this.hist = [];
    this.calib = [];
    this.neckBase = null;
    this.firstSeen = null;
    this.speedSlow = 0;
    this.bodyFirst = null;
    this.f = { speed: 0, fidget: 0, handsFace: 0, contraction: 0, startle: 0, shrug: 0 };
    this.n = { ...this.f };
    this.raw = { fear: 0, tension: 0, calm: 1 };
    this.parts = { bodyFear: 0, bodyTension: 0, faceFear: 0, faceTension: 0 };

    this.lastBody = -1e9;
    this.lastFace = -1e9;
    this.bodyConf = 0;
    this.faceConf = 0;
    this.prevFaceT = null;
    this.faceFirst = null;
    this.faceCalib = null;
    this.faceBase = null;
    this.fr = Object.fromEntries(Object.keys(C.faceRanges).map((k) => [k, 0])); // face coefficients after subtracting the baseline
    this.fn = { ...this.fr };
  }

  markSeen(t) {
    this.lastSeen = t;
    if (!this.present) {
      this.present = true;
      this.firstSeen = t;
    }
  }

  // Called once per new face frame; cats is MediaPipe's faceBlendshapes[0].categories
  observeFace(cats, t) {
    if (!cats) return;
    const dt = this.prevFaceT == null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - this.prevFaceT));
    this.prevFaceT = t;
    this.lastFace = t;
    this.markSeen(t);

    const b = {};
    for (const c of cats) b[c.categoryName] = c.score;
    const avg = (...keys) => keys.reduce((a, k) => a + (b[k] || 0), 0) / keys.length;
    const raw = {
      browRaise: 0.6 * (b.browInnerUp || 0) + 0.4 * avg('browOuterUpLeft', 'browOuterUpRight'),
      eyeWide: avg('eyeWideLeft', 'eyeWideRight'),
      mouthStretch: avg('mouthStretchLeft', 'mouthStretchRight'),
      jawOpen: b.jawOpen || 0,
      browDown: avg('browDownLeft', 'browDownRight'),
      lipPress: Math.max(avg('mouthPressLeft', 'mouthPressRight'), avg('mouthRollLower', 'mouthRollUpper')),
      eyeSquint: avg('eyeSquintLeft', 'eyeSquintRight'),
      frown: avg('mouthFrownLeft', 'mouthFrownRight'),
      smile: avg('mouthSmileLeft', 'mouthSmileRight'),
    };

    // Record this person's resting face during the first seconds as a baseline
    if (this.faceFirst == null) {
      this.faceFirst = t;
      this.faceCalib = { n: 0, sum: Object.fromEntries(Object.keys(raw).map((k) => [k, 0])) };
    }
    if (t - this.faceFirst < C.calibrateTime) {
      this.faceCalib.n++;
      for (const k in raw) this.faceCalib.sum[k] += raw[k];
      this.faceBase = Object.fromEntries(
        Object.keys(raw).map((k) => [k, Math.min(C.faceBaseCap, this.faceCalib.sum[k] / this.faceCalib.n)]),
      );
    } else if (this.weights.calm > 0.7) {
      for (const k in raw) this.faceBase[k] = Math.min(C.faceBaseCap, ema(this.faceBase[k], raw[k], dt, 30));
    }

    for (const k in raw) this.fr[k] = ema(this.fr[k], Math.max(0, raw[k] - this.faceBase[k]), dt, 0.25);
  }

  // Called once per new camera frame
  observe(lms, aspect, t) {
    if (!lms || vis(lms[11]) < 0.5 || vis(lms[12]) < 0.5) return;
    const dt = this.prevT == null ? 1 / 30 : Math.max(1e-3, Math.min(0.2, t - this.prevT));
    this.prevT = t;
    this.lastBody = t;
    this.markSeen(t);
    if (this.bodyFirst == null) this.bodyFirst = t;

    // Scale x by the aspect ratio so horizontal and vertical distances are comparable
    const P = lms.map((p) => ({ x: p.x * aspect, y: p.y, v: vis(p) }));
    if (!this.sm) this.sm = P.map((p) => ({ ...p }));
    const prev = this.sm.map((p) => ({ x: p.x, y: p.y }));
    const k = 1 - Math.exp(-dt / C.posTau);
    this.sm.forEach((s, i) => {
      s.x += (P[i].x - s.x) * k;
      s.y += (P[i].y - s.y) * k;
      s.v = P[i].v;
    });
    const L = this.sm;

    // Shoulder width is the unit of scale, so distance from the camera doesn't matter
    const S = dist(L[11], L[12]);
    if (S < 0.03) return;
    const c = { x: (L[11].x + L[12].x) / 2, y: (L[11].y + L[12].y) / 2 };
    const f = this.f;

    // 1. Overall movement speed
    const keys = [0, 13, 14, 15, 16];
    let sp = 0;
    for (const i of keys) sp += dist(L[i], prev[i]);
    sp = sp / keys.length / S / dt;
    f.speed = ema(f.speed, sp, dt, 0.4);

    // 2. Fidgeting: path length much larger than net displacement = back-and-forth movement
    this.hist.push({ t, pts: [0, 15, 16].map((i) => ({ x: L[i].x, y: L[i].y })) });
    while (this.hist.length && t - this.hist[0].t > C.fidgetWindow) this.hist.shift();
    if (this.hist.length > 3) {
      const span = Math.max(0.2, t - this.hist[0].t);
      const last = this.hist.length - 1;
      let back = 0;
      for (let j = 0; j < 3; j++) {
        let path = 0;
        for (let h = 1; h <= last; h++) path += dist(this.hist[h].pts[j], this.hist[h - 1].pts[j]);
        back += path - dist(this.hist[last].pts[j], this.hist[0].pts[j]);
      }
      f.fidget = ema(f.fidget, back / 3 / S / span, dt, 0.5);
    }

    // 3. Hands near the face (covering the face, guarding the head)
    const nose = L[0];
    const dl = L[15].v > 0.3 ? dist(L[15], nose) / S : 9;
    const dr = L[16].v > 0.3 ? dist(L[16], nose) / S : 9;
    f.handsFace = ema(f.handsFace, mapR(Math.min(dl, dr), C.ranges.handsFace), dt, 0.3);

    // 4. Contraction (hands held at the chest, crossed arms)
    const hipsOk = L[23].v > 0.4 && L[24].v > 0.4;
    const hipY = hipsOk ? (L[23].y + L[24].y) / 2 : c.y + 1.4 * S;
    const chest = (w) =>
      w.v > 0.3 && w.y > c.y - 0.15 * S && w.y < hipY ? mapR(Math.abs(w.x - c.x) / S, [0.8, 0.3]) : 0;
    let con = (chest(L[15]) + chest(L[16])) / 2;
    const crossed =
      L[15].v > 0.3 && L[16].v > 0.3 &&
      Math.sign(L[15].x - L[16].x) !== Math.sign(L[11].x - L[12].x) &&
      Math.abs(L[15].x - L[16].x) > 0.1 * S &&
      L[15].y < hipY && L[16].y < hipY;
    if (crossed) con = Math.max(con, 0.9);
    f.contraction = ema(f.contraction, con, dt, 0.4);

    // 5. Startle: a sudden burst of speed, or quickly stepping back (shoulder width shrinks)
    this.speedSlow = ema(this.speedSlow, sp, dt, 3);
    const retreat = this.prevS ? Math.max(0, -(Math.log(S) - Math.log(this.prevS)) / dt) : 0;
    this.prevS = S;
    const spike = Math.max(0, sp - this.speedSlow) + retreat * 2;
    f.startle = Math.max(f.startle * Math.exp(-dt / C.startleHold), mapR(spike, C.ranges.startle));

    // 6. Shrug / hunched neck: nose-to-shoulder-line distance relative to this person's baseline
    const neck = (c.y - L[0].y) / S;
    if (t - this.bodyFirst < C.calibrateTime) {
      this.calib.push(neck);
      this.neckBase = this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
    } else if (this.weights.calm > 0.7) {
      this.neckBase = ema(this.neckBase, neck, dt, 25);
    }
    f.shrug = this.neckBase > 0 ? ema(f.shrug, (this.neckBase - neck) / this.neckBase, dt, 0.4) : 0;
  }

  score() {
    const R = C.ranges;
    const f = this.f;
    const n = (this.n = {
      speed: mapR(f.speed, R.speed),
      fidget: mapR(f.fidget, R.fidget),
      handsFace: f.handsFace,
      contraction: f.contraction,
      startle: f.startle,
      shrug: mapR(f.shrug, R.shrug),
    });
    const fn = (this.fn = Object.fromEntries(Object.keys(this.fr).map((k) => [k, mapR(this.fr[k], C.faceRanges[k])])));
    const sum = (w, src) => Object.entries(w).reduce((a, [key, v]) => a + v * src[key], 0);
    const p = (this.parts = {
      bodyFear: sum(C.weights.fear, n),
      bodyTension: sum(C.weights.tension, n),
      faceFear: sum(C.faceWeights.fear, fn),
      faceTension: sum(C.faceWeights.tension, fn),
    });

    // Fusion: weight each signal by how visible it currently is
    const wb = (1 - C.faceWeight) * this.bodyConf;
    const wf = C.faceWeight * this.faceConf;
    const k = wb + wf > 1e-3 ? wf / (wb + wf) : 0;
    const fear = (1 - k) * p.bodyFear + k * p.faceFear;
    const tension = (1 - k) * p.bodyTension + k * p.faceTension;
    const calm = 2 * C.threshold - Math.max(fear, tension) + C.smileCalm * fn.smile * this.faceConf;
    this.raw = { fear, tension, calm };
    const e = STATES.map((s) => Math.exp(C.softmaxGain * this.raw[s]));
    const z = e.reduce((a, b) => a + b, 0);
    STATES.forEach((s, i) => (this.target[s] = e[i] / z));
  }

  // Called every animation frame: smooth weights, handle departures, pick the discrete state
  tick(t, dt) {
    if (this.force) {
      this.present = true;
      STATES.forEach((s) => (this.target[s] = s === this.force ? 1 : 0));
    } else if (this.present && t - this.lastSeen > C.absentTimeout) {
      this.present = false;
      this.resetPerson();
      this.target = { fear: 0, tension: 0, calm: 1 };
    } else if (this.present) {
      this.bodyConf = ema(this.bodyConf, t - this.lastBody < 0.5 ? 1 : 0, dt, 0.3);
      this.faceConf = ema(this.faceConf, t - this.lastFace < 0.5 ? 1 : 0, dt, 0.3);
      this.score();
    }
    for (const s of STATES) this.weights[s] = ema(this.weights[s], this.target[s], dt, C.weightTau);

    const top = STATES.reduce((a, b) => (this.weights[a] >= this.weights[b] ? a : b));
    if (top === this.state) this.cand = null;
    else if (this.cand !== top) {
      this.cand = top;
      this.candT = t;
    } else if (t - this.candT > C.holdTime) {
      this.state = top;
      this.cand = null;
    }
  }
}
