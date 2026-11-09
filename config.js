// Every tunable parameter lives here — this is the only file to edit when tuning on site.

export const CONFIG = {
  camera: { width: 1280, height: 720, mirror: true }, // face tracking needs a reasonably sharp face
  model:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  faceModel:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  faceEvery: 1, // run face tracking every N frames (set to 2 if the computer struggles)

  // ───────── Emotion recognition (heuristics) ─────────
  emotion: {
    posTau: 0.06,        // landmark smoothing (s), suppresses tracking jitter
    absentTimeout: 1.5,  // how long after someone leaves the scene counts as empty
    calibrateTime: 2.0,  // first seconds of a visit, recorded as the person's natural baseline
    fidgetWindow: 1.2,   // time window for measuring fidgeting
    startleHold: 2.5,    // decay time of the startle signal
    weightTau: 1.5,      // state-weight smoothing (larger = slower, softer transitions)
    holdTime: 1.5,       // how long a new state must dominate before switching
    softmaxGain: 5,
    threshold: 0.38,     // fear/tension scores must exceed this to outweigh calm

    // raw body feature → 0..1 mapping range [low, high]
    ranges: {
      speed: [0.4, 2.0],      // limb speed (shoulder widths / s)
      fidget: [0.35, 1.6],    // fidgeting intensity
      startle: [0.8, 3.0],    // sudden movement / stepping back
      shrug: [0.08, 0.3],     // shrug / hunched neck (fraction shorter than baseline)
      handsFace: [1.2, 0.5],  // wrist-to-nose distance (shoulder widths): far → 0, near → 1
    },
    weights: {
      fear: { handsFace: 0.35, contraction: 0.25, startle: 0.25, shrug: 0.15 },
      tension: { fidget: 0.45, shrug: 0.3, speed: 0.25 },
    },

    // ───── Face (52 MediaPipe blendshapes, informed by FACS action units) ─────
    // final score = body score × (1 − faceWeight) + face score × faceWeight
    // With no visible face (head down, turned away, too far) only the body counts; with only a face, only the face.
    faceWeight: 0.55,
    faceBaseCap: 0.2, // resting faces differ: the first seconds become a baseline, subtracting at most this much
    faceRanges: {      // coefficient after baseline subtraction → 0..1
      browRaise: [0.05, 0.4],    // raised brows (especially inner brows)
      eyeWide: [0.05, 0.35],     // widened eyes
      mouthStretch: [0.05, 0.35],// lips stretched sideways
      jawOpen: [0.1, 0.5],       // open jaw
      browDown: [0.05, 0.4],     // lowered, knitted brows
      lipPress: [0.05, 0.35],    // pressed or sucked-in lips
      eyeSquint: [0.05, 0.35],   // squinting, tense eyelids
      frown: [0.05, 0.3],        // mouth corners pulled down
      smile: [0.1, 0.6],         // smile
    },
    faceWeights: {
      fear: { browRaise: 0.3, eyeWide: 0.35, mouthStretch: 0.25, jawOpen: 0.1 },
      tension: { browDown: 0.35, lipPress: 0.3, eyeSquint: 0.2, frown: 0.15 },
    },
    smileCalm: 0.5, // bonus a smile adds to calm
  },

  breathHz: 0.1, // breathing guide: 6 breaths/min; sound and plants rise and fall with it

  audio: {
    master: 0.5,
    idleLevel: 0.25,  // ambient level when nobody is present
    mode: 'both',     // 'binaural' (needs headphones) | 'isochronic' (works on speakers) | 'both'
    solfeggioGain: 0.07,   // volume of each Solfeggio tone (they slowly swell in and out)
    solfeggioFloor: 0.35,  // quietest point of the swell (0 = fades to silence, 1 = constant)
  },

  visual: {
    dprMax: 1.5,
    dotSpacing: 3.2,
    trail: 0.2,        // trails: lower = dreamier
    growRate: 0.55,
    witherRate: 0.35,
    pollenRate: 14,
    maxParticles: 1400,
    showBody: true,    // draw the visitor's skeleton as faint particles

    // How the plants respond to the Solfeggio tones
    resonance: {
      hzPerBand: 132,   // one standing-wave light band per this many Hz (396 Hz → 3 bands, 963 Hz → ~7)
      strength: 1,      // brightness / swelling of the bands
      pollen: 10,       // pollen per second released from the bright bands at full volume
      cymatics: true,   // Chladni pattern on the ground
    },
  },

  // ───────── Three states: sound + plant ─────────
  states: {
    fear: {
      label: 'Fear', en: 'FERN', band: 'θ Theta', beat: 6,
      intent: 'grounding · safety',
      binaural: { carrier: 136.1, gain: 0.12 },
      iso: { carrier: 272.2, depth: 0.6, gain: 0.035 },
      pad: { root: 68.05, ratios: [1, 1.5, 2, 3], type: 'sine', cutoff: 600, gain: 0.2 },
      noise: { cutoff: 350, gain: 0.12 },
      solfeggio: [396, 417], // 396: releasing fear · 417: undoing, facilitating change
      plant: 'fern',
      palette: ['#0b5e66', '#138a8a', '#2fb8a8', '#7fe0cf', '#c8fff2'],
      accent: ['#8fd3ff', '#b9f2ff', '#e6fbff'],
    },
    tension: {
      label: 'Tension', en: 'GRASS', band: 'α Alpha', beat: 10,
      intent: 'release · breath',
      binaural: { carrier: 200, gain: 0.11 },
      iso: { carrier: 400, depth: 0.5, gain: 0.03 },
      pad: { root: 100, ratios: [1, 1.25, 1.5, 2, 3], type: 'sine', cutoff: 1200, gain: 0.15 },
      noise: { cutoff: 900, gain: 0.07 },
      solfeggio: [639, 741], // 639: harmony, connection · 741: cleansing, expression
      plant: 'grass',
      palette: ['#2f6b34', '#4f9a45', '#86c460', '#c3e58a', '#f2f7b8'],
      accent: ['#ffe9a8', '#fff3c9', '#d8ffb0'],
    },
    calm: {
      label: 'Calm', en: 'BLOSSOM', band: 'SMR · 528', beat: 14,
      intent: 'growth · openness',
      binaural: { carrier: 264, gain: 0.08 },
      iso: { carrier: 528, depth: 0.4, gain: 0.025 },
      pad: { root: 132, ratios: [1, 2, 2.5, 3, 4], type: 'sine', cutoff: 2400, gain: 0.12 },
      noise: { cutoff: 3000, gain: 0.03 },
      solfeggio: [528, 852, 963], // 528: transformation · 852: intuition · 963: oneness
      plant: 'tree',
      palette: ['#6e4426', '#a8703c', '#cf9c5a', '#7fc88a', '#c4f0b4'],
      accent: ['#ff9ec7', '#ffc4dd', '#fff0f6', '#ffd27f'],
    },
  },
};
