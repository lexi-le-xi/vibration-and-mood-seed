import { CONFIG } from './config.js';
import { EmotionAnalyzer, STATES } from './emotion.js';
import { AudioEngine } from './audio.js';
import { Garden } from './plants.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const $ = (s) => document.querySelector(s);

const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const video = $('#cam');
const dbg = $('#dbgcam');
const dctx = dbg.getContext('2d');

const emo = new EmotionAnalyzer();
const audio = new AudioEngine();
const garden = new Garden();

let W = 0, H = 0;
let landmarker = null;
let faceLandmarker = null;
let lastVideoTime = -1;
let frameNo = 0;
let lms = null;
let faceLms = null;
let prevHands = [null, null];
let showHud = true, showDebug = false;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, CONFIG.visual.dprMax);
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#030508';
  ctx.fillRect(0, 0, W, H);
}
addEventListener('resize', resize);
resize();

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: CONFIG.camera.width, height: CONFIG.camera.height, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

async function initModels() {
  const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import(`${MP}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const create = async (Task, path, extra) => {
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO', ...extra });
    try {
      return await Task.createFromOptions(fileset, opts('GPU'));
    } catch {
      return await Task.createFromOptions(fileset, opts('CPU'));
    }
  };
  landmarker = await create(PoseLandmarker, CONFIG.model, { numPoses: 1 });
  status('Loading face model…');
  try {
    faceLandmarker = await create(FaceLandmarker, CONFIG.faceModel, { numFaces: 1, outputFaceBlendshapes: true });
  } catch (e) {
    console.warn('Face model failed to load; using body tracking only', e);
  }
}

const status = (s) => ($('#status').textContent = s);

$('#start').addEventListener('click', async () => {
  $('#start').disabled = true;
  status('Starting sound…');
  await audio.start();
  requestAnimationFrame(loop);
  try {
    status('Opening camera…');
    await initCamera();
    status('Loading pose model…');
    await initModels();
    $('#intro').classList.add('hidden');
  } catch (e) {
    console.error(e);
    status('Camera or model unavailable — demo mode: press 1 / 2 / 3 to switch states');
    setTimeout(() => $('#intro').classList.add('hidden'), 2500);
  }
});

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1') emo.force = 'fear';
  else if (k === '2') emo.force = 'tension';
  else if (k === '3') emo.force = 'calm';
  else if (k === '0') emo.force = null;
  else if (k === 'h') $('#hud').classList.toggle('hidden', (showHud = !showHud) === false);
  else if (k === 'd') setDebug(!showDebug);
  else if (k === 'm') audio.toggleMute();
  else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});

// Camera view: toggled by the corner icon or the D key; "details" reveals the live numbers
const camBtn = $('#camToggle');
function setDebug(on) {
  showDebug = on;
  $('#debug').classList.toggle('hidden', !on);
  camBtn.setAttribute('aria-pressed', on);
  camBtn.setAttribute('aria-label', on ? 'Hide camera view' : 'Show camera view');
}
camBtn.addEventListener('click', () => setDebug(!showDebug));
$('#dbgMore').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', on);
  $('#dbgtxt').hidden = !on;
});

// Hide the cursor (and the closed icon) after 3 s without mouse movement
let idleTimer;
function wakeCursor() {
  document.body.classList.remove('cursor-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('cursor-idle'), 3000);
}
addEventListener('mousemove', wakeCursor);
wakeCursor();

// Map normalized camera coordinates onto the canvas (fit to height, mirrored)
function toCanvas(p, aspect) {
  const x = CONFIG.camera.mirror ? 1 - p.x : p.x;
  return { x: W / 2 + (x - 0.5) * aspect * H, y: p.y * H, v: p.visibility ?? 1 };
}

let last = performance.now();
let audioTick = 0;

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;

  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    lms = res.landmarks?.[0] || null;
    emo.observe(lms, aspect, t);
    if (faceLandmarker && frameNo++ % CONFIG.faceEvery === 0) {
      const fr = faceLandmarker.detectForVideo(video, now);
      faceLms = fr.faceLandmarks?.[0] || null;
      emo.observeFace(fr.faceBlendshapes?.[0]?.categories, t);
    }
  }
  emo.tick(t, dt);

  if ((audioTick += dt) > 0.1) {
    audioTick = 0;
    audio.setWeights(emo.weights, emo.present);
  }

  const ba = audio.breathAngle();
  const breath = Math.sin(ba);
  const energy = audio.energy();

  const body = lms && emo.present ? lms.map((p) => toCanvas(p, aspect)) : null;
  const hands = [];
  [15, 16].forEach((idx, j) => {
    const p = body?.[idx];
    if (!p || p.v < 0.5) return (prevHands[j] = null);
    if (prevHands[j] && dt > 0) hands.push({ x: p.x, y: p.y, vx: (p.x - prevHands[j].x) / dt, vy: (p.y - prevHands[j].y) / dt });
    prevHands[j] = p;
  });

  const tones = audio.toneLevels(emo.weights, emo.present);
  garden.update(dt, t, emo.weights, emo.present, breath, energy, hands, emo.state, W, H, tones);
  garden.draw(ctx, W, H, t, breath, body, emo.weights);

  updateHud(Math.cos(ba) > 0);
  if (showDebug) drawDebug();
  requestAnimationFrame(loop);
}

function updateHud(inhale) {
  const st = CONFIG.states[emo.state];
  $('#idle').style.opacity = (1 - garden.presence).toFixed(3);
  if (!showHud) return;
  $('#st-label').textContent = emo.present ? st.label : 'Waiting';
  $('#st-en').textContent = emo.present ? st.en : 'SEED';
  $('#solf').textContent = emo.present ? `solfeggio ${st.solfeggio.join(' · ')} Hz` : '';
  $('#st-sub').textContent = emo.present
    ? `${st.band} · ${st.beat} Hz · ${st.intent}${emo.force ? ' · manual' : ''}`
    : 'Come closer — the seed can feel you';
  $('#sense-body').style.opacity = (0.2 + 0.8 * emo.bodyConf).toFixed(2);
  $('#sense-face').style.opacity = (0.2 + 0.8 * emo.faceConf).toFixed(2);
  for (const s of STATES) $(`#bar-${s}`).style.width = `${(emo.weights[s] * 100).toFixed(1)}%`;
  $('#breath').textContent = inhale ? 'inhale' : 'exhale';
}

function drawDebug() {
  // Match the camera's aspect ratio so the image isn't stretched
  const want = video.videoWidth ? Math.round((dbg.width * video.videoHeight) / video.videoWidth) : dbg.height;
  if (dbg.height !== want) dbg.height = want;
  const w = dbg.width, h = dbg.height;
  dctx.save();
  if (CONFIG.camera.mirror) {
    dctx.translate(w, 0);
    dctx.scale(-1, 1);
  }
  if (video.readyState >= 2) dctx.drawImage(video, 0, 0, w, h);
  else {
    dctx.fillStyle = '#111';
    dctx.fillRect(0, 0, w, h);
  }
  if (lms) {
    dctx.fillStyle = '#7fe0cf';
    for (const p of lms) if ((p.visibility ?? 1) > 0.4) dctx.fillRect(p.x * w - 3, p.y * h - 3, 6, 6);
  }
  if (faceLms) {
    dctx.fillStyle = '#ffc4dd';
    for (let i = 0; i < faceLms.length; i += 3) dctx.fillRect(faceLms[i].x * w, faceLms[i].y * h, 1.5, 1.5);
  }
  dctx.restore();
  if ($('#dbgtxt').hidden) return;
  const f = emo.f, n = emo.n, r = emo.raw, p = emo.parts;
  const row = (src, norm) => (k) => `${k.padEnd(12)} ${src[k].toFixed(2).padStart(6)}  → ${norm[k].toFixed(2)}`;
  $('#dbgtxt').textContent = [
    `present ${emo.present}   state ${emo.state}   force ${emo.force ?? '-'}`,
    `── body  (conf ${emo.bodyConf.toFixed(2)})`,
    ...Object.keys(f).map(row(f, n)),
    `── face  (conf ${emo.faceConf.toFixed(2)})`,
    ...Object.keys(emo.fr).map(row(emo.fr, emo.fn)),
    `body  fear ${p.bodyFear.toFixed(2)}  tension ${p.bodyTension.toFixed(2)}`,
    `face  fear ${p.faceFear.toFixed(2)}  tension ${p.faceTension.toFixed(2)}`,
    `final fear ${r.fear.toFixed(2)}  tension ${r.tension.toFixed(2)}  calm ${r.calm.toFixed(2)}`,
    `── solfeggio output (measured)`,
    ...audio.toneMeter().map(({ f, state, db }) => {
      const n = Math.max(0, Math.min(20, Math.round((db + 110) / 3)));
      return `${String(f).padStart(4)} Hz ${'█'.repeat(n).padEnd(20, '·')} ${db.toFixed(0).padStart(4)} dB  ${state}`;
    }),
    `particles ${garden.parts.length}`,
  ].join('\n');
}
