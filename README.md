# Vibration & Mood Seed

A camera reads body movement and facial expression → infers an emotional state (fear / tension / calm) → plays sound tuned to that state → the sound becomes a living garden of particle plants.

**Live:** https://lexi-le-xi.github.io/vibration-and-mood-seed/ (open in Chrome, allow the camera, headphones recommended)

## Running

To run it locally instead:

Browsers won't run this by double-clicking `index.html` (camera access and JS modules need a local server). Open a terminal in this folder and run:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in Chrome, click **BEGIN** and allow camera access.

| Key | Action |
|---|---|
| F | Fullscreen |
| H | Show / hide the status panel (bottom left) |
| D | Camera view (same as clicking the icon in the top-right corner) |
| M | Mute |
| 1 / 2 / 3 | Force fear / tension / calm (for demos) |
| 0 | Back to automatic detection |

## Structure

| File | Contents |
|---|---|
| `config.js` | **Every tunable parameter**: detection thresholds, frequencies, colors, growth speed |
| `emotion.js` | 33 pose landmarks + 52 facial blendshapes → fused weights for the three states |
| `audio.js` | Real-time Web Audio synthesis, crossfaded by state weight |
| `plants.js` | Three particle plants, pollen, standing-wave resonance, cymatics, the visitor's particle skeleton, and the idle "seed" |
| `main.js` | Camera, MediaPipe pose and face tracking, main loop, interface |

### Body cues → emotion

| Cue | How it's measured | Points to |
|---|---|---|
| Hands near face | Wrist-to-nose distance | Fear |
| Contraction | Hands held at the chest / crossed arms | Fear |
| Startle | Sudden burst of speed or stepping back quickly | Fear |
| Shrug / hunched neck | Nose-to-shoulder-line distance relative to the person's first 2 seconds | Fear + tension |
| Fidgeting | Back-and-forth hand and head movement (path length ≫ net displacement) | Tension |
| Movement speed | Mean landmark speed | Tension |

All distances are measured in shoulder widths, so it works the same whether someone stands near or far.

### Facial expression → emotion

| Expression | FACS action unit | Points to |
|---|---|---|
| Raised brows (especially inner brows) | AU1 + AU2 | Fear |
| Widened eyes | AU5 | Fear |
| Lips stretched sideways | AU20 | Fear |
| Lowered, knitted brows | AU4 | Tension |
| Pressed or sucked-in lips | AU24 / AU28 | Tension |
| Squinting, tense eyelids | AU7 | Tension |
| Smile | AU12 | Bonus toward calm |

Everyone's resting face is different (some people naturally have low brows), so each visitor's first 2 seconds are recorded as their baseline and only changes from it are counted.

### Fusing body and face

`final score = body score × (1 − faceWeight) + face score × faceWeight`, with the face at 55% by default (`config.js → emotion.faceWeight`).
If the face isn't visible (head down, turned away, too far), only the body is used; if only the face is visible, only the face is used. The "● body ● face" indicators in the bottom left light up to show which signals are currently active.

### Emotion → sound → plant

| State | Brainwave target | Sound | Solfeggio tones | Plant | Intent |
|---|---|---|---|---|---|
| Fear | θ theta 6 Hz | Low 136.1 Hz drone + wave-like brown noise | 396 · 417 Hz | Fern, slowly unfurling from a curled fiddlehead | Grounding, safety |
| Tension | α alpha 10 Hz | 200 Hz major chord + wind | 639 · 741 Hz | Grass, swaying with wind and breath | Release, follow the breath |
| Calm | SMR 14 Hz | Bright 132 / 264 / 528 Hz harmonics | 528 · 852 · 963 Hz | Blossoming tree shedding pollen | Growth, openness |

Each voice combines a **binaural beat** (left/right frequency difference; needs headphones), an **isochronic tone** (amplitude pulses; works on speakers), a **pad**, **noise**, and **Solfeggio tones**: pure sine tones that each swell in and out on their own 20–40 s cycle, surfacing one after another like singing bowls. They are assigned by their traditional associations (396 releasing fear, 417 facilitating change, 639 harmony, 741 cleansing, 528 transformation, 852 intuition, 963 oneness); edit `solfeggio` per state and `audio.solfeggioGain` in `config.js`. The pad and noise swell with a 0.1 Hz (6 breaths per minute) breathing guide, the plants breathe in sync, and the bottom-left panel shows "inhale / exhale".

### Plants that resonate with the Solfeggio tones

The tones themselves vibrate hundreds of times per second, far too fast to see (and flashing at such rates would be unsafe), so the plants borrow two images from physics:

- **Standing waves.** Each sounding tone lays bright bands (antinodes) along its plant from root to tip, like a plucked string. The number of bands follows the pitch: one band per 132 Hz, so 396 Hz gives 3 bands and 963 Hz about 7. The plant swells slightly at each band, and the bands drift slowly upward.
- **Color by frequency.** Frequencies map onto the visible spectrum on a log scale: 396 Hz is red, 528 Hz yellow-green, 963 Hz violet. The bands, and the pollen that rises from them, take on the tone's color.
- **Cymatics.** On the ground, each tone draws its Chladni figure, the pattern sand forms on a vibrating plate, so higher tones make more intricate patterns.

Everything follows each tone's slow swell in the sound, so you see a tone grow as you hear it grow. Settings are in `config.js → visual.resonance` (`hzPerBand`, `strength`, `pollen`, `cymatics`). If the frame rate drops, lower `strength` or set `cymatics: false`.

## Tuning on site

1. Press **D** to open the debug panel. Ask a few people to stand normally, hug themselves with raised shoulders, fidget, look scared, frown, and so on.
2. Watch each feature's raw value (left of the arrow) and adjust the ranges in `config.js → emotion.ranges` (body) and `emotion.faceRanges` (face) so a neutral state sits near the low end and a clear expression reaches the high end.
3. Too sensitive → raise `threshold`. Switching too fast → increase `weightTau` and `holdTime`.
4. Face tracking needs a clear face: visitors should stand 0.5–2 m from the camera with frontal light. If the computer struggles, set `faceEvery` to 2.
5. Speakers in the space → set `audio.mode` to `'isochronic'`. Headphones provided → `'both'`.

## Things to keep in mind

- **Scientific grounding**: reading emotion from posture and expression is only approximate. Dancing happily can register as "tension", expressions can be masked, and they vary across cultures and individuals. Claims that specific frequencies act on specific brain regions have limited evidence, research on binaural beats for relaxation is mixed, and the meanings attached to the Solfeggio frequencies come from New Age tradition rather than scientific evidence. In the thesis, frame this as **speculative, artistic experience design**, not a medical or therapeutic effect.
- **Photosensitive epilepsy**: the visuals deliberately avoid any 3–30 Hz flicker (the only pulsing is the 0.1 Hz breathing). Keep it that way if you change the visuals: never flash the screen at brainwave frequencies. A photosensitivity notice at the exhibit is still a good idea.
- **Privacy**: all tracking runs locally in the browser. Nothing is recorded or uploaded.
- **Offline exhibition**: the MediaPipe library and models currently load from the internet (jsdelivr / Google). If the venue has no internet, download `vision_bundle.mjs`, the `wasm/` folder from `@mediapipe/tasks-vision`, and both `.task` models (pose + face), then update `MP` in `main.js` and `model` / `faceModel` in `config.js`.
