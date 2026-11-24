# Grad-B Drift — Interactive 3D Simulation: Build Guide

A complete brief for building a clean, presentation-ready 3D simulation of
*Thrysøe et al. (2025), "Measuring grad-B drift in a model of a magnetized torus
using a modified Helmholtz coil", Phys. Educ. 60 045035.*

You can follow this yourself or hand it to a coding assistant as the spec.

---

## 1. The goal in one sentence

Let an audience **tilt two coils and watch an electron's circle stop closing**, then
show *why* it happens and *why fusion reactors care*, with a screen that looks like
a polished product, not a physics worksheet.

## 2. Design rules (read these before writing any code)

1. **The 3D scene is the star.** No equations on screen. At most one short sentence
   of narration per chapter, and at most three numbers in the readout.
2. **Every control must change something visible and meaningful.** If moving a
   slider doesn't visibly change the beam, that slider doesn't exist.
3. **Controls speak the audience's language.** "Coil tilt", "Field strength",
   "Beam energy", not "R₀", "B₀" or "U". Show real units small and secondary.
4. **Ranges come from the real apparatus,** so nothing breaks or looks absurd
   (orbit always fits inside the glass bulb, drift is always visible when tilted).
5. **Presets beat fiddling.** One click gets you to "Uniform field", "Paper's setup"
   or "Exaggerated drift". In a live presentation you will mostly click presets.
6. **Physics is honest underneath.** The trajectory is computed from the real force
   law in SI units, so the numbers match the paper. Simplifications are only
   allowed in the Tokamak chapter, and are labelled "not to scale".
7. **Calm motion.** Smooth camera moves (≈600 ms ease-in-out), no flashing, no
   bouncing UI, no particle-confetti.

## 3. Structure: three chapters

A slim chapter bar at the top: **1 · The Experiment → 2 · Why It Drifts → 3 · The Tokamak**.
Arrow keys / number keys switch chapters (handy with a presentation clicker).

| Chapter | What the audience sees | Purpose |
|---|---|---|
| 1 · The Experiment | A 3D replica of the paper's setup: copper coils, glass bulb, glowing orange beam | Reproduce the paper (its figure 5) |
| 2 · Why It Drifts | Top-down slow-motion view of one orbit over a field-strength glow | Build intuition: tight half + wide half = no closed loop |
| 3 · The Tokamak | A full doughnut of coils with a cloud of electrons and ions | What the bench can't show: charge separation and plasma loss, and the fix |

An optional **4 · Virtual Lab** (results graph) is described in §8.

---

## 4. Chapter 1 — The Experiment

### 4.1 Scene

- **Two Helmholtz coils**: copper rings, mean radius 15 cm, ring thickness ~1.2 cm,
  wound look (a subtle normal map or fine ridges). Mounted on dark grey axles above a
  matte black base plate with **two meshing gears** visible at the bottom; the gears
  rotate when tilt changes. That one detail sells "this is the real device".
- **Glass bulb**: sphere of radius 8 cm (≈ the real fine beam tube), centred between
  the coils. Physical glass material (transmission ~0.95, roughness ~0.05, faint
  blue rim like the photo). Electron gun: small metal stem coming up from the
  bottom of the bulb.
- **Beam**: glowing orange tube (#FF9A3C core, softer #FF6A1A halo) with bloom.
  Because the real beam is a steady glow, draw the **whole computed path** as a
  static glowing line, and add a few small bright "sparks" travelling along it so
  the direction of motion is obvious.
- **Background**: near-black with a soft vignette (#0B0E14 → #05070A). One key
  light, one cool rim light, soft shadows on the base plate.

### 4.2 Controls (right-hand card — this is the whole list)

| Control | Type | Range | Default | Shown to user as |
|---|---|---|---|---|
| **Coil tilt** | slider | 0° – 40° | 0° | Label under slider: "Parallel" at 0°, a tick marked "Paper" at 34.4°, "Tokamak-like" at the right end |
| **Field strength** | slider | 1.2 – 3.0 A | 2.0 A | "Field strength", with small text "2.0 A · 1.49 mT" |
| **Beam energy** | slider | 150 – 300 V | 250 V | "Beam energy", small text "250 V" |
| **Particle** | 2-way toggle | Electron / Positron | Electron | Positron = "same mass, opposite charge"; its drift flips direction |
| **Play / Pause**, **Reset** | buttons | | | icons only |

**Presets** (chips above the sliders):

| Preset | Tilt | Current | Voltage | What happens |
|---|---|---|---|---|
| Uniform field | 0° | 2.0 A | 250 V | One perfect closed circle (r ≈ 3.6 cm) |
| Paper's setup | 34.4° | 2.0 A | 250 V | Loops step ≈ 1.6 cm each orbit |
| Exaggerated drift | 40° | 1.4 A | 250 V | Big orbit (r ≈ 5.1 cm), loops step ≈ 3.8 cm |

Changing any control **smoothly re-grows** the beam from the gun (about 0.8 s) rather
than snapping. Tilting the coils animates the coils *and* gears together.

**View toggles** (small icon row at bottom-right, all off by default):
- *Field lines*: 10–15 thin cyan curves (#5CC8FF, 35% opacity) traced through the bulb.
  In the tilted setup they visibly bend into arcs, which is the "torus" moment.
- *Field strength*: a translucent colour wash on a vertical plane through the bulb
  centre, perpendicular to the coil axis: deeper blue = stronger. Shows the
  gradient without any arrows or numbers.
- *Guiding centre*: a dashed white line through the centres of the loops: makes the
  drift direction unmistakable.
- *Ruler*: a measuring scale that snaps to two neighbouring loops and shows the gap.

**Camera presets** (three small buttons): *Front* (matches the paper's photo),
*Side*, *Free orbit*. Free orbit uses damped OrbitControls with zoom limits so you
can't fly inside the base plate.

### 4.3 Readout card (bottom-left, max three lines)

```
Orbit size           3.6 cm
Shift per loop       1.6 cm   (measured)
Theory predicts      1.6 cm   ✓ 2% apart
```

- When tilt = 0, the second and third lines collapse into "Loop closes ✓".
- The ✓ badge turns amber if measured vs predicted differ by more than 15%
  (happens with big orbits at large tilt). Hovering it shows one sentence:
  "Big orbits feel a changing gradient, so the simple formula gets less accurate."
  This is the paper's own discussion point, delivered without a formula.

### 4.4 Narration line (top-centre, one sentence, changes with state)

- Tilt = 0: "Parallel coils make a uniform field, so the electron runs in a perfect circle."
- Tilt > 0: "Tilted coils make the field stronger on one side, so the circle no longer closes."
- Positron selected: "Opposite charge, opposite drift."

---

## 5. Chapter 2 — Why It Drifts

A focused explainer view of the same physics. Camera glides to look **straight along the field**,
so the orbit is seen face-on.

- Background plane shows the field-strength wash (strong side deep blue, weak side
  pale), with the words "Stronger field" and "Weaker field" on each side in small caps.
  No vector arrows needed.
- One electron moves in **slow motion**. Its path is drawn in two colours:
  **tight curve** on the strong side, **wide curve** on the weak side.
- A **step-through** button ("Next ▸") walks through four beats, each with a single
  caption:
  1. "In a stronger field the electron turns more tightly…"
  2. "…and in a weaker field it swings wider."
  3. "Tight half + wide half doesn't join up."
  4. "So every loop shifts sideways: that's the grad-B drift."
- A **ghost circle** (faint dashed) shows where a closed orbit would have been, so the
  mismatch is obvious.
- One control only: **"Gradient"** slider (none → strong). At "none" the ghost and real
  paths coincide.

---

## 6. Chapter 3 — The Tokamak

Clearly badged **"Stylised · not to scale"** in the corner.

- **Scene**: a translucent doughnut vessel (major radius 1.0 scene unit, minor 0.3),
  ringed by 16 copper D-shaped or circular coils. Slow auto-rotation until touched.
- **Particles**: ~300 electrons (blue #6FB7FF) and ~300 ions (warm orange #FFB347),
  each with a short fading trail. Real mass ratio is impossible to show, so use an
  ion/electron mass ratio of ~25 and give both species the same energy.
- **Three stages**, driven by a step button and one toggle:

| Stage | Trigger | What happens | Caption |
|---|---|---|---|
| A | Start | Toroidal field only. Electrons drift up, ions drift down. A soft blue glow builds at the top, orange at the bottom | "Electrons and ions drift in opposite directions." |
| B | Automatic after ~4 s | The separated charge creates a vertical electric field (show faint vertical arrows fading in). Now **everything** drifts outward and hits the outer wall (tiny sparks on impact) | "The separated charge pushes the whole plasma outward. It's lost." |
| C | Toggle **"Add plasma current"** | Field lines visibly twist into helices around the doughnut. Particles now stay confined, circulating | "Twisting the field lines lets the charges flow back. This is why real tokamaks need a plasma current." |

The only controls in this chapter: **Step ▸**, **Add plasma current** toggle,
**Reset**. Nothing else.

---

## 7. Visual style guide

| Element | Spec |
|---|---|
| Background | Radial gradient #0B0E14 → #05070A |
| Coils | Copper PBR: base #B87333, metalness 0.9, roughness 0.35 |
| Glass | MeshPhysicalMaterial, transmission 0.95, IOR 1.5, faint #9FD8FF rim |
| Beam / ions | Orange #FF9A3C with bloom (strength ~1.2, radius ~0.4) |
| Electrons (Ch. 3), field lines | Cool blue #6FB7FF / cyan #5CC8FF |
| UI cards | #11151D at 80% opacity, 1 px border #FFFFFF14, radius 14 px, backdrop blur 12 px |
| Text | Inter (or SF Pro): 13 px labels, 15 px values, 20 px narration; #E8ECF2 primary, #8A93A3 secondary |
| Accent | One accent colour only (the beam orange) for active slider, selected preset, ✓ badge |
| Motion | 600 ms ease-in-out for camera, 200 ms for UI states |
| Layout | Full-screen canvas · chapter bar top-centre · controls right · readout bottom-left · view toggles bottom-right |

**Presentation mode** (press `P`): hides the controls card, enlarges narration to
28 px, keeps only the readout. `F` = fullscreen, `1/2/3` = chapters, `Space` =
play/pause, `→` = next step / next preset.

---

## 8. Optional chapter 4 — Virtual Lab (results graph)

Recreates the paper's figure 6b/8 idea without clutter.

- One button: **"Run current sweep"**. The sim steps the current from 1.2 A to 3.0 A
  (8 points), "measures" the shift per loop each time (with ±0.1 cm of random
  reading error added, as a student with a ruler would have), and plots the points
  live.
- Two theory lines appear afterwards: **"Simple doughnut model"** and **"Real coil
  shape"**. They visibly diverge, mirroring the 1.7× gradient difference the paper
  discusses.
- Chart: minimal, dark, no gridlines except light horizontal ones; axes "Coil
  current (A)" and "Shift per loop (cm)".

---

## 9. Engine room (implementation details — none of this appears on screen)

### 9.1 Tech stack

- **Three.js** (current release) with `OrbitControls`, `EffectComposer` +
  `UnrealBloomPass`, and `Line2`/`LineMaterial` (fat lines) or `TubeGeometry` for the beam.
- Plain HTML/CSS for UI (no lil-gui/dat.gui: it looks like a debug panel).
- Either a **single `index.html`** using an import map from a CDN (easiest to share and
  present offline once cached), or a small **Vite** project:

```
/src
  main.js          – boot, chapter router, render loop
  physics.js       – fields, Boris pusher, drift measurement
  sceneLab.js      – Chapter 1 & 2 objects
  sceneTokamak.js  – Chapter 3
  ui.js            – controls, readout, narration, keyboard
  style.css
index.html
```

### 9.2 Units and scaling

- Physics in **SI** (metres, seconds, tesla). Render with **1 scene unit = 1 cm**.
- Constants: mₑ = 9.109e-31 kg, e = 1.602e-19 C, μ₀ = 4π×10⁻⁷.
- Coils (from the manufacturer): N = 124 turns, R = 0.150 m.
- Time: one orbit takes ~24 ns, so the animation is pure slow motion. Show a tiny
  "×10⁹ slow motion" tag in the corner. Never real-time.

### 9.3 Mapping the controls to physics

```
speed            v = sqrt(2 e U / mₑ)                 (U = Beam energy in volts)
centre field     B₀ = 0.7155 · μ₀ N I / R             (I = Field strength in amps)
curvature        R₀ = R / (2 sin(tilt/2))             (tilt = 0 → R₀ = ∞ → uniform)
```

Geometry: bulb centre at the origin. **Coil axis = z** (field direction at the
centre), **x = radial** (pointing away from the doughnut's hole), **y = vertical**
(drift direction). The doughnut's symmetry axis is the vertical line at
(x = −R₀, z = 0). Each coil is rotated by tilt/2 about its own vertical axis, with
its centre at distance R₀ from that symmetry axis.

### 9.4 Field models

**Model A — ideal doughnut (default for the trajectory):**
let ρ = distance from the symmetry axis in the x-z plane, φ̂ = unit vector going round it.

```
B(position) = B₀ · (R₀ / ρ) · φ̂
```

When tilt = 0, use a uniform field B₀ ẑ instead (avoid dividing by infinity).

**Model B — real coils (for field lines, field-strength wash, and Chapter 4's
second theory line):** Biot–Savart sum over each coil split into 72 straight segments:

```
B += (μ₀ N I / 4π) · (dl × r) / |r|³     for every segment of both coils
```

Precompute Model B on a 32³ grid over the bulb when settings change, and use trilinear
interpolation. Don't evaluate it raw inside the integrator every step.

### 9.5 The integrator — use Boris, not Euler

Plain Euler steps make circles spiral outward (fake energy gain, which looks like a
fake drift). The Boris method keeps the speed exact:

```js
// one step of size dt, q/m = qm, magnetic field only
function borisStep(pos, vel, B, qm, dt) {
  const t = B.clone().multiplyScalar(qm * dt / 2);
  const s = t.clone().multiplyScalar(2 / (1 + t.lengthSq()));
  const vPrime = vel.clone().add(vel.clone().cross(t));
  vel.add(vPrime.cross(s));
  pos.addScaledVector(vel, dt);
}
```

- `qm` is the *signed* charge-to-mass ratio (negative for the electron).
- Step size: 400 steps per orbit (dt = T/400, T = 2π mₑ / (e B₀)).
- Compute the **whole path up front** whenever a control changes: start at the gun
  (bottom of bulb, 7.5 cm below centre), velocity horizontal along +x for an electron
  and along −x for a positron (so both curve upward into the bulb instead of into the glass), run until the
  particle leaves the 8 cm bulb or completes 8 loops. That's < 4 000 steps, so it's instant.
- Draw that polyline as the beam; animate sparks along it.

### 9.6 Measuring "shift per loop" inside the sim

Record the particle's position every time its velocity direction completes a full
turn (track the accumulated angle of v in the x-y plane; each 2π = one loop).
Shift per loop = average change in **y** between consecutive records. Predicted value
for the readout:

```
predicted = π · r_L² / R₀,   with r_L = mₑ v / (e B₀)
```

### 9.7 Tokamak chapter physics (stylised)

- Scene units arbitrary; particles pushed with the same Boris step.
- Toroidal field B ∝ 1/ρ. Give each particle a random velocity along the field too,
  so it streams round the doughnut.
- Stage B: compute a uniform vertical E field proportional to
  (electrons above midplane − ions above midplane), capped, and add qE to the push.
  This is enough to reproduce the outward E×B loss visually.
- Stage C: add a poloidal field component B_pol = B_tor · r / (2 R₀)
  (r = distance from the tube's centre line). Twisted lines average the vertical
  drift out; particles stay inside.
- Remove a particle when it touches the vessel wall; respawn it near the core after
  a short delay in stage C only.

---

## 10. Build order (each milestone ends with something you can demo)

1. **Static scene**: coils, gears, base, bulb, lighting, bloom, camera presets.
2. **Physics core**: `physics.js` with Model A + Boris; draw a closed circle at tilt 0.
3. **Controls + presets**: sliders re-grow the beam; tilt animates coils and gears.
4. **Readout + narration**: measured vs predicted shift, ✓ badge, one-line captions.
5. **View toggles**: guiding centre, ruler, then field lines and field-strength wash (Model B).
6. **Chapter 2**: top-down explainer with step-through.
7. **Chapter 3**: tokamak with stages A → B → C.
8. **Polish**: presentation mode, keyboard shortcuts, transitions, performance pass.
9. *(Optional)* **Chapter 4** virtual lab sweep.

## 11. Definition of done (test these before presenting)

- [ ] Tilt 0°: the loop closes; after 8 loops the start and end points differ by < 0.1 mm.
- [ ] Particle speed stays constant to within 0.01% over the whole path.
- [ ] Paper's setup preset: shift per loop ≈ 1.6 cm, within 10% of the prediction.
- [ ] Positron drifts the opposite way to the electron, with the same size of shift.
- [ ] Every slider position keeps the first loop inside the bulb.
- [ ] Raising the field strength makes loops smaller and the shift much smaller (≈ 1/current²).
- [ ] Holds 60 fps on a normal laptop with bloom on; Chapter 3 holds 45+ fps.
- [ ] Nothing on screen shows an equation; the readout never shows more than three lines.
- [ ] Presentation mode works with only the keyboard / a clicker.
- [ ] Credits line in a small "About" popover: the paper's citation, DOI
      10.1088/1361-6552/ade18f, and "Coil specs: 3B Scientific U8481500".

## 12. Reference numbers (for checking your build)

| Setting (tilt · current · voltage) | Field at centre | Orbit radius | Shift per loop |
|---|---|---|---|
| 0° · 2.0 A · 250 V | 1.49 mT | 3.6 cm | 0 (closed) |
| 34.4° · 2.0 A · 250 V | 1.49 mT | 3.6 cm | 1.6 cm |
| 34.4° · 1.5 A · 250 V | 1.11 mT | 4.8 cm | 2.8 cm |
| 34.4° · 3.0 A · 150 V | 2.23 mT | 1.9 cm | 0.4 cm |
| 40° · 1.4 A · 250 V | 1.04 mT | 5.1 cm | 3.8 cm |
| 40° · 1.2 A · 300 V | 0.89 mT | 6.6 cm | 6.1 cm |

(Shift values use the simple doughnut model; your simulated values should be close to these, and drift a little further apart for the largest orbits.)
