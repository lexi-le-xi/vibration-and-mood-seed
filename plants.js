// Particle plants: each plant is a tree of segments, each segment made of glowing particles.
//   fear    → fern (slowly unfurls from a curled fiddlehead)
//   tension → grass (sways with wind and breath — a visible breathing guide)
//   calm    → blossoming tree (branches grow, then bloom and shed pollen)
// When nobody is present, a breathing "mood seed" is shown.

import { CONFIG } from './config.js';
import { STATES } from './emotion.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v) => 1 - (1 - v) ** 3;
const smooth = (v) => v * v * (3 - 2 * v);
const REF = 900; // plant sizes are authored for a 900px-tall screen

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  gauss() { return (this.f() + this.f() + this.f() - 1.5) / 0.5; }
}

// Map a frequency onto the visible spectrum: 396 Hz → red … 963 Hz → violet
const F_LO = 396, F_HI = 963;
export function toneNorm(f) {
  return clamp01(Math.log2(f / F_LO) / Math.log2(F_HI / F_LO));
}
function toneHex(f) {
  const h = toneNorm(f) * 280, s = 0.85, l = 0.66;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// Chladni figure: points where a vibrating plate stays still (the nodal lines).
// Non-integer modes give every frequency its own pattern; higher = more intricate.
const chladniCache = new Map();
function chladni(f) {
  if (chladniCache.has(f)) return chladniCache.get(f);
  const kk = f / CONFIG.visual.resonance.hzPerBand;
  const n = kk * 0.55, m = kk * 1.3;
  const rnd = mulberry32(Math.round(f * 100));
  const pts = [];
  for (let tries = 0; pts.length < 520 && tries < 200000; tries++) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
    if (x * x + y * y > 1) continue;
    const v = Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) - Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);
    if (Math.abs(v) < 0.035) pts.push(x, y);
  }
  chladniCache.set(f, pts);
  return pts;
}

const sprites = new Map();
function sprite(hex) {
  if (sprites.has(hex)) return sprites.get(hex);
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const n = parseInt(hex.slice(1), 16);
  const [r, gg, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (k) =>
    `${Math.round(r + (255 - r) * k)},${Math.round(gg + (255 - gg) * k)},${Math.round(b + (255 - b) * k)}`;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${mix(0.6)},1)`);
  grd.addColorStop(0.18, `rgba(${mix(0.15)},0.9)`);
  grd.addColorStop(0.45, `rgba(${r},${gg},${b},0.28)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  sprites.set(hex, c);
  return c;
}

class Plant {
  constructor(kind, palette, accent) {
    this.kind = kind;
    this.spr = palette.map(sprite);
    this.accSpr = accent.map(sprite);
    this.alpha = 0;
    this.build((Math.random() * 1e9) | 0);
  }

  build(seed) {
    this.r = new Rng(seed);
    this.segs = [];
    this.tips = [];
    this.g = 0;
    this.peak = 0;
    if (this.kind === 'tree') this.buildTree();
    else if (this.kind === 'grass') this.buildGrass();
    else this.buildFern();
    const n = this.segs.length;
    for (const k of ['sx', 'sy', 'ex', 'ey', 'wa', 'sv']) this[k] = new Float32Array(n);
    // Normalized distance from the root (0 at the base, 1 at the farthest tip): standing waves run along it
    let hMax = 1e-6;
    for (const s of this.segs) {
      s.h0 = s.p < 0 ? 0 : this.segs[s.p].h1;
      s.h1 = s.h0 + s.len;
      hMax = Math.max(hMax, s.h1);
    }
    for (const s of this.segs) {
      s.h0 /= hMax;
      s.h1 /= hMax;
    }
    this.res = [];
    this.maxOrder = Math.max(
      ...this.segs.map((s) => s.order + s.dur),
      ...this.tips.map((t) => t.order + 1.5),
    );
  }

  add(o) {
    const s = Object.assign(
      { p: -1, rx: 0.5, a: 0, len: 0.05, order: 0, dur: 1, thick: 0, col: 0,
        sway: 0, swayF: 0.8, phase: 0, breath: 0, curl: 0, fold: 0 },
      o,
    );
    const r = this.r;
    const n = Math.max(2, Math.round(((s.len * REF) / CONFIG.visual.dotSpacing) * (1 + s.thick * 0.35)));
    s.dots = [];
    for (let i = 0; i < n; i++) {
      s.dots.push({
        u: (i + r.next()) / n, o: r.gauss() * s.thick, s: r.range(0.7, 1.3),
        a: r.range(0.35, 0.9), tw: r.range(0.3, 1.6), ph: r.range(0, TAU),
        c: Math.min(this.spr.length - 1, s.col + (r.next() < 0.25 ? 1 : 0)),
      });
    }
    this.segs.push(s);
    return this.segs.length - 1;
  }

  buildTree() {
    const r = this.r;
    const maxD = 6;
    const pal = this.spr.length;
    const branch = (p, a, len, depth, order) => {
      const n = depth < 2 ? 4 : 3;
      const thick = depth >= 4 ? 4 : 7 * 0.62 ** depth;
      const col = Math.min(pal - 1, Math.floor(((depth + 0.5) / (maxD + 1)) * pal));
      let idx = p;
      for (let i = 0; i < n; i++) {
        idx = this.add({
          p: idx, a: i === 0 ? a : r.range(-0.14, 0.14), len: len / n,
          order: order + i / n, dur: 1 / n, thick, col,
          sway: 0.012 * (depth + 1), swayF: r.range(0.4, 0.8), phase: r.range(0, TAU),
          breath: 0.006 * depth,
        });
      }
      if (depth >= maxD || (depth > 3 && r.next() < 0.12)) {
        this.tips.push({
          seg: idx, order: order + 1, kind: 'blossom', size: r.range(5, 10),
          rot: r.range(0, TAU), petals: r.int(5, 6), c: r.int(0, this.accSpr.length - 2), ph: r.range(0, TAU),
        });
        return;
      }
      const k = depth < 2 && r.next() < 0.4 ? 3 : 2;
      for (let j = 0; j < k; j++) {
        const spread = k === 2 ? (j === 0 ? -1 : 1) * r.range(0.3, 0.6) : (j - 1) * r.range(0.45, 0.65);
        branch(idx, spread, len * r.range(0.68, 0.8), depth + 1, order + 1);
      }
    };
    const trunk = this.segs.length;
    branch(-1, r.range(-0.06, 0.06), 0.2, 0, 0);
    this.segs[trunk].rx = 0.5;
  }

  buildGrass() {
    const r = this.r;
    const pal = this.spr.length;
    const nSeg = 14;
    for (let s = 0; s < 34; s++) {
      const rx = 0.04 + 0.92 * r.next();
      const delay = r.range(0, 2.5);
      const total = r.range(0.28, 0.62);
      const lean = r.range(-0.035, 0.035);
      let idx = -1;
      for (let i = 0; i < nSeg; i++) {
        const f = i / nSeg;
        idx = this.add({
          p: idx, rx, a: i === 0 ? r.range(-0.3, 0.3) : lean + r.range(-0.02, 0.02),
          len: total / nSeg, order: delay + i * 0.3, dur: 0.3,
          thick: 2.2 * (1 - f) + 0.4, col: Math.min(pal - 1, Math.floor(f * pal)),
          sway: 0.025, swayF: 0.9, phase: rx * 6, breath: 0.012,
        });
      }
      this.tips.push({
        seg: idx, order: delay + nSeg * 0.3, kind: 'seed', size: r.range(4, 8),
        c: r.int(0, this.accSpr.length - 1), ph: r.range(0, TAU),
      });
    }
  }

  buildFern() {
    const r = this.r;
    const nSeg = 20;
    for (const cx of [0.2, 0.8]) {
      const fronds = r.int(4, 5);
      for (let fi = 0; fi < fronds; fi++) {
        const baseA = -1 + (2 * (fi + 0.5)) / fronds + r.range(-0.15, 0.15);
        const side = baseA < 0 ? -1 : 1;
        const total = r.range(0.35, 0.55);
        const bend = side * r.range(0.02, 0.045);
        const delay = r.range(0, 2);
        const rx = cx + r.range(-0.03, 0.03);
        let idx = -1;
        for (let i = 0; i < nSeg; i++) {
          const f = i / nSeg;
          idx = this.add({
            p: idx, rx, a: i === 0 ? baseA : bend, len: total / nSeg,
            order: delay + i * 0.12, dur: 0.12, thick: 1.6 * (1 - f) + 0.3, col: r.next() < 0.5 ? 0 : 1,
            sway: 0.01, swayF: 0.5, phase: r.range(0, TAU), breath: 0.008 * side,
            curl: side * 0.95 * f ** 1.5, // curls into a fiddlehead before unfurling
          });
          if (i < 2 || i >= nSeg - 1) continue;
          const pl = (0.075 * Math.sin(Math.PI * f) ** 0.8 * total) / 0.45;
          for (const lr of [-1, 1]) {
            let q = idx;
            for (let k = 0; k < 3; k++) {
              q = this.add({
                p: q, a: k === 0 ? lr * (1.15 - 0.4 * f) : -lr * 0.12, len: pl / 3,
                order: delay + 1 + i * 0.18 + k * 0.15, dur: 0.15, thick: 0.6, col: k > 0 ? 3 : 2,
                sway: 0.03, swayF: 1.1, phase: r.range(0, TAU), fold: k === 0 ? 1 : 0,
              });
            }
          }
        }
        this.tips.push({
          seg: idx, order: delay + nSeg * 0.12 + 0.5, kind: 'spore', size: r.range(3, 6),
          c: r.int(0, this.accSpr.length - 1), ph: r.range(0, TAU),
        });
      }
    }
  }

  update(dt, w, present) {
    if (present && w > 0.12) this.g = Math.min(this.maxOrder, this.g + dt * CONFIG.visual.growRate * (0.4 + w));
    else this.g = Math.max(0, this.g - dt * CONFIG.visual.witherRate);
    this.peak = Math.max(this.peak, this.g);
    const target = present ? clamp01(w * 1.5) : this.g > 0.2 ? 0.45 : 0;
    this.alpha += (target - this.alpha) * (1 - Math.exp(-dt / 1.2));
    // Once fully withered, reseed so every visitor sees a different plant
    if (this.g === 0 && this.peak > 1 && this.alpha < 0.03) this.build((Math.random() * 1e9) | 0);
  }

  layout(W, H, U, t, breath) {
    const segs = this.segs;
    const unf = this.kind === 'fern' ? smooth(clamp01((this.g - 1.5) / 5)) : 1;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      let bx, by, pa;
      if (s.p < 0) {
        bx = s.rx * W;
        by = H + 2;
        pa = -Math.PI / 2;
      } else {
        bx = this.ex[s.p];
        by = this.ey[s.p];
        pa = this.wa[s.p];
      }
      const vis = clamp01((this.g - s.order) / s.dur);
      let a = s.fold ? s.a * (0.12 + 0.88 * unf) : s.a;
      a += pa + s.sway * Math.sin(t * s.swayF - s.phase) + s.breath * breath + s.curl * (1 - unf);
      const L = s.len * U * easeOut(vis);
      this.sx[i] = bx;
      this.sy[i] = by;
      this.wa[i] = a;
      this.ex[i] = bx + Math.cos(a) * L;
      this.ey[i] = by + Math.sin(a) * L;
      this.sv[i] = vis;
    }
  }

  bloom(tp) {
    return clamp01((this.g - tp.order) / 1.5);
  }

  draw(ctx, U, t, energy, breath) {
    if (this.alpha < 0.01 || this.g <= 0) return;
    const k = U / REF;
    const A = this.alpha;
    const glow = 0.85 + energy * 0.6;
    const segs = this.segs;
    const res = this.res;
    const RS = CONFIG.visual.resonance.strength;
    for (let i = 0; i < segs.length; i++) {
      const v = this.sv[i];
      if (v <= 0) continue;
      const x0 = this.sx[i], y0 = this.sy[i];
      const dx = this.ex[i] - x0, dy = this.ey[i] - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const fade = Math.min(1, v * 2);
      const s = segs[i];
      for (const d of s.dots) {
        // Standing waves: bright bands (antinodes) along the plant, one set per sounding tone
        let b = 0, bMax = 0, bi = -1;
        if (res.length) {
          const h = s.h0 + (s.h1 - s.h0) * d.u;
          for (let j = 0; j < res.length; j++) {
            const w = Math.sin(res[j].k * Math.PI * h + res[j].ph);
            const val = res[j].lvl * w * w;
            b += val;
            if (val > bMax) (bMax = val), (bi = j);
          }
          b *= RS;
        }
        const a = A * d.a * (0.55 + 0.45 * Math.sin(t * d.tw + d.ph)) * fade * (1 + 1.2 * b);
        if (a < 0.02) continue;
        const o = d.o * k * (1 + 0.9 * b); // the plant swells at the antinodes, like a vibrating string
        const x = x0 + dx * d.u + nx * o, y = y0 + dy * d.u + ny * o;
        const r = d.s * k * 4 * glow * (1 + 0.4 * b);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(this.spr[d.c], x - r, y - r, r * 2, r * 2);
        if (bMax * RS > 0.25) {
          const rr = r * 1.4;
          ctx.globalAlpha = Math.min(1, A * d.a * fade * bMax * RS * 0.7);
          ctx.drawImage(res[bi].spr, x - rr, y - rr, rr * 2, rr * 2);
        }
      }
    }

    for (const tp of this.tips) {
      const b = this.bloom(tp);
      if (b <= 0) continue;
      const be = easeOut(b);
      const cx = this.ex[tp.seg], cy = this.ey[tp.seg];
      const sp = this.accSpr[tp.c];
      if (tp.kind === 'blossom') {
        const rot = tp.rot + 0.2 * Math.sin(t * 0.25 + tp.ph);
        ctx.globalAlpha = A * 0.7 * be;
        for (let j = 0; j < tp.petals; j++) {
          const th = rot + (j / tp.petals) * TAU;
          for (const m of [0.4, 0.75, 1]) {
            const rr = tp.size * k * m * be * (1 + 0.12 * breath);
            const r = k * (5 - m * 2);
            ctx.drawImage(sp, cx + Math.cos(th) * rr - r, cy + Math.sin(th) * rr - r, r * 2, r * 2);
          }
        }
        const r = k * 7 * be;
        ctx.globalAlpha = A * 0.8;
        ctx.drawImage(this.accSpr[this.accSpr.length - 1], cx - r, cy - r, r * 2, r * 2);
      } else if (tp.kind === 'seed') {
        const a = this.wa[tp.seg];
        ctx.globalAlpha = A * 0.75 * be;
        for (let j = 0; j < 6; j++) {
          const m = j / 5;
          const rr = tp.size * k * m * 2.2 * be;
          const off = (j % 2 ? 2 : -2) * k * be;
          const r = k * (4 - m * 1.5);
          const x = cx + Math.cos(a) * rr - Math.sin(a) * off;
          const y = cy + Math.sin(a) * rr + Math.cos(a) * off;
          ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
        }
      } else {
        const r = k * tp.size * 1.6 * be * (1 + 0.25 * Math.sin(t * 0.8 + tp.ph));
        ctx.globalAlpha = A * 0.9 * be;
        ctx.drawImage(sp, cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
}

const BODY = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export class Garden {
  constructor() {
    this.plants = {};
    for (const s of STATES) {
      const c = CONFIG.states[s];
      this.plants[s] = new Plant(c.plant, c.palette, c.accent);
    }
    this.parts = [];
    this.presence = 0;
    this.energy = 0;
    this.emitAcc = {};
    this.seedSpr = sprite(CONFIG.states.calm.accent[3]);
    this.seedSpr2 = sprite(CONFIG.states.fear.accent[1]);
    this.bodySpr = sprite('#bcd7ff');
    this.toneSpr = (f) => sprite(toneHex(f));
    this.tones = [];
  }

  spawn(x, y, vx, vy, spr, size) {
    if (this.parts.length >= CONFIG.visual.maxParticles) return;
    this.parts.push({ x, y, vx, vy, spr, size, age: 0, life: 3 + Math.random() * 4 });
  }

  update(dt, t, weights, present, breath, energy, hands, dominant, W, H, tones = []) {
    this.tones = tones;
    const U = Math.min(H, W * 0.8);
    this.U = U;
    this.energy += (energy - this.energy) * (1 - Math.exp(-dt / 0.3));
    this.presence += ((present ? 1 : 0) - this.presence) * (1 - Math.exp(-dt / 1.5));
    const k = U / REF;

    for (const s of STATES) {
      const p = this.plants[s];
      p.update(dt, weights[s], present);
      p.layout(W, H, U, t, breath);
      // Pollen / spores drift from fully grown tips
      this.emitAcc[s] = (this.emitAcc[s] || 0) + CONFIG.visual.pollenRate * p.alpha * (0.4 + this.energy * 2) * dt;
      while (this.emitAcc[s] >= 1) {
        this.emitAcc[s] -= 1;
        const tp = p.tips[(Math.random() * p.tips.length) | 0];
        if (!tp || p.bloom(tp) < 0.6) continue;
        this.spawn(
          p.ex[tp.seg], p.ey[tp.seg],
          (Math.random() - 0.5) * 20 * k, -(8 + Math.random() * 18) * k,
          p.accSpr[(Math.random() * p.accSpr.length) | 0], (2 + Math.random() * 2) * k,
        );
      }
    }

    // When a visitor waves, particles in the current state's colors scatter from their hands
    const accSpr = this.plants[dominant].accSpr;
    for (const h of hands) {
      const sp = Math.hypot(h.vx, h.vy);
      if (sp < 150) continue;
      const n = Math.min(6, sp / 200);
      for (let i = 0; i < n; i++) {
        this.spawn(
          h.x + (Math.random() - 0.5) * 10, h.y + (Math.random() - 0.5) * 10,
          h.vx * 0.15 + (Math.random() - 0.5) * 30, h.vy * 0.15 + (Math.random() - 0.5) * 30,
          accSpr[(Math.random() * accSpr.length) | 0], (2 + Math.random() * 3) * k,
        );
      }
    }

    // Each tone drives a standing wave on its own state's plant; the bands drift slowly upward.
    // Band motion stays below ~0.15 Hz: no flicker at brainwave rates.
    const R = CONFIG.visual.resonance;
    for (const s of STATES) {
      const p = this.plants[s];
      p.res = tones
        .filter((tn) => tn.state === s && tn.level > 0.01)
        .map((tn) => ({
          k: tn.f / R.hzPerBand,
          lvl: tn.level,
          ph: -t * (0.35 + 0.5 * toneNorm(tn.f)),
          spr: this.toneSpr(tn.f),
        }));
      // Pollen in the tone's color rises from the bright bands
      for (const rz of p.res) {
        if (Math.random() > rz.lvl * R.pollen * p.alpha * dt) continue;
        for (let tries = 0; tries < 6; tries++) {
          const i = (Math.random() * p.segs.length) | 0;
          if (p.sv[i] < 0.9) continue;
          const sg = p.segs[i], u = Math.random();
          const w = Math.sin(rz.k * Math.PI * (sg.h0 + (sg.h1 - sg.h0) * u) + rz.ph);
          if (w * w < 0.75) continue;
          this.spawn(
            p.sx[i] + (p.ex[i] - p.sx[i]) * u, p.sy[i] + (p.ey[i] - p.sy[i]) * u,
            (Math.random() - 0.5) * 16 * k, -(10 + Math.random() * 20) * k, rz.spr, (2 + Math.random() * 2.5) * k,
          );
          break;
        }
      }
    }

    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age > p.life) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vx += (Math.sin(p.y * 0.012 + t * 0.4) * 12 * k - p.vx * 0.5) * dt;
      p.vy += (-15 * k - p.vy) * 0.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx, W, H, t, breath, body, weights) {
    const U = this.U;
    const k = U / REF;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(3,5,8,${CONFIG.visual.trail})`;
    ctx.fillRect(0, 0, W, H);

    // Ground glow: the three state colors mixed by weight
    let r = 0, g = 0, b = 0;
    for (const s of STATES) {
      const n = parseInt(CONFIG.states[s].palette[2].slice(1), 16);
      r += ((n >> 16) & 255) * weights[s];
      g += ((n >> 8) & 255) * weights[s];
      b += (n & 255) * weights[s];
    }
    const grd = ctx.createLinearGradient(0, H, 0, H * 0.6);
    grd.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.05 + 0.05 * this.presence})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);

    ctx.globalCompositeOperation = 'lighter';

    if (CONFIG.visual.showBody && body) {
      ctx.globalAlpha = 0.14 * this.presence;
      for (const [a, c] of BODY) {
        const p = body[a], q = body[c];
        if (!p || !q || p.v < 0.4 || q.v < 0.4) continue;
        const n = Math.max(2, Math.hypot(q.x - p.x, q.y - p.y) / 7) | 0;
        for (let j = 0; j <= n; j++) {
          const u = j / n;
          const jx = Math.sin(a * 13.1 + j * 7.7 + t * 0.7) * 4;
          const jy = Math.cos(c * 9.3 + j * 5.1 + t * 0.6) * 4;
          const rr = 5 * k;
          ctx.drawImage(this.bodySpr, p.x + (q.x - p.x) * u + jx - rr, p.y + (q.y - p.y) * u + jy - rr, rr * 2, rr * 2);
        }
      }
    }

    // Cymatics: each sounding tone draws its Chladni figure on the ground, as if the garden grew on a vibrating plate
    if (CONFIG.visual.resonance.cymatics) {
      const cx = W / 2, cy = H * 0.93;
      const R = Math.min(W * 0.42, H * 0.7), sq = 0.2;
      const rot = t * 0.02;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (const tn of this.tones) {
        if (tn.level < 0.03) continue;
        const pts = chladni(tn.f), spr = this.toneSpr(tn.f);
        const s = 2.6 * k;
        ctx.globalAlpha = Math.min(1, tn.level * 0.45);
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i] * cr - pts[i + 1] * sr, y = pts[i] * sr + pts[i + 1] * cr;
          ctx.drawImage(spr, cx + x * R - s, cy + y * R * sq - s, s * 2, s * 2);
        }
      }
    }

    // The mood seed (when nobody is present)
    const idle = 1 - this.presence;
    if (idle > 0.01) {
      const cx = W / 2, cy = H * 0.74;
      const R = 26 * k * (1 + 0.22 * breath);
      ctx.globalAlpha = idle * 0.9;
      const cr = R * 1.4;
      ctx.drawImage(this.seedSpr, cx - cr, cy - cr, cr * 2, cr * 2);
      for (let j = 0; j < 48; j++) {
        const th = (j / 48) * TAU + t * 0.15 * (j % 2 ? 1 : -1);
        const rr = R * (1.6 + 0.25 * Math.sin(j * 3.1 + t * 0.5));
        const s = 3.5 * k;
        ctx.globalAlpha = idle * (0.35 + 0.3 * Math.sin(j + t * 0.6));
        ctx.drawImage(j % 3 ? this.seedSpr : this.seedSpr2, cx + Math.cos(th) * rr - s, cy + Math.sin(th) * rr * 0.8 - s, s * 2, s * 2);
      }
    }

    for (const s of ['grass', 'fern', 'tree'].map((kind) => STATES.find((st) => CONFIG.states[st].plant === kind))) {
      if (s) this.plants[s].draw(ctx, U, t, this.energy, breath);
    }

    for (const p of this.parts) {
      ctx.globalAlpha = Math.sin((Math.PI * p.age) / p.life) * 0.7;
      ctx.drawImage(p.spr, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
