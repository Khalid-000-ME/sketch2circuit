# Sketch → Circuit
## Product Requirements Document

| | |
|---|---|
| **Version** | 1.0 |
| **Status** | Approved for build |
| **Author** | Khalid |
| **Last updated** | 2 Nov 2026 |
| **Submission deadline** | 5 Nov 2026, 06:30 IST |
| **Context** | Meta Global AI Developer Hackathon — Indie track, "Push the Frontier" |

---

# 1. Executive summary

**Sketch → Circuit** turns a photograph of a hand-drawn circuit diagram into an
interactive, physically-rendered 3D circuit that tells you what is wrong with your
design.

A beginner draws a circuit on paper. They photograph it. Within seconds they see
their circuit assemble itself in 3D — real components, real materials, real light —
and a red pulse on the LED they were about to destroy, with a sentence explaining
why and a concrete fix.

Digitisation is the plumbing. **The review is the product.**

### 1.1 The problem

Electronics education has a brutal feedback loop. A beginner draws a circuit,
builds it, and finds out it was wrong when something gets hot, releases smoke, or
silently does nothing. The gap between "I drew this" and "I know if this works" is
measured in destroyed components and abandoned projects.

Existing tools do not close it:

- **Simulators (LTspice, Falstad, Tinkercad)** require you to already know how to
  express the circuit in their language. The sketch on your paper is not the input.
- **Research pipelines (Sketch2Sim, SINA, Img2Sim-V2)** convert sketches to netlists
  but stop at digitisation. They tell you what you drew, not whether it is sane.
- **Text-to-schematic tools (SpeedUp AI, pcbGPT)** go the opposite direction — they
  generate schematics from requirements, so the sketch is never an input at all.

Nobody takes the artefact the beginner actually has — a messy drawing on lined
paper — and returns judgement on it.

### 1.2 The solution

A three-stage pipeline wrapped in a renderer that makes the result feel real:

1. **Perceive** — SAM 3.1 segments the drawing; Muse Spark identifies components,
   reads handwritten values, and recovers connectivity.
2. **Judge** — the recovered graph is converted to a SPICE netlist, simulated, and
   run through rule checks that produce human-readable findings.
3. **Show** — the circuit renders as a 3D board with procedurally generated
   components under image-based lighting. Faults glow. Components are selectable
   and editable, and edits re-run the analysis live.

### 1.3 Why it wins the hackathon

| Criterion | Weight | How this hits it |
|---|---|---|
| **Impact** | 30% | Every electronics beginner burns components learning this. A non-expert judge understands the problem in one sentence. |
| **Use of Meta tooling** | 25% | SAM 3.1 for segmentation, Muse Spark for reasoning. Remove either and the product does not exist. Not a wrapper around one API call. |
| **Demo** | 25% | Paper sketch → 3D board materialising → red pulse on the fault. The hook lands in 20 seconds. |
| **Technical depth** | 20% | Vision pipeline, graph recovery, SPICE integration, custom procedural WebGL renderer. Four non-trivial systems. |

### 1.4 Evidence base

The 2026 hackathon winner sets show a consistent shift toward **AI that checks
work and defers to humans** — RedAgent (Most Impactful, GitLab 2026) for verifying
AI-generated findings, DocSync for escalating when confidence is low, Aegis for
explaining every decision. Simultaneously, the Gemini Live Agent Challenge grand
prize (ORION) and category winner (drone-copilot) went to agents that **perceive
and act in physical or real-time environments**.

This product sits at the intersection: perception of the physical world, in service
of verification. That is the lane that is winning, and it has not yet been won in
the electronics domain.

---

# 2. Users

### 2.1 Primary persona — "The self-taught beginner"

**Arjun, 19, engineering student.** Has an Arduino kit and a breadboard. Learns from
YouTube. Draws circuits in a notebook before building them because he was told to.
Has already killed two LEDs and does not know why.

- **Needs:** to know if his circuit is safe *before* he connects the battery.
- **Cannot:** use LTspice. He tried. The component picker alone defeated him.
- **Has:** a phone camera and a notebook.
- **Success looks like:** "Oh — I need a resistor there. That's why."

### 2.2 Secondary persona — "The lab instructor"

**Dr. Priya, teaches a first-year circuits lab, 60 students.** Spends the first
twenty minutes of every session checking hand-drawn pre-lab diagrams one by one.

- **Needs:** to triage 60 sketches quickly and spot the dangerous ones.
- **Success looks like:** students arrive with already-checked circuits.

### 2.3 Tertiary persona — "The hobbyist"

**Marcus, 40s, builds guitar pedals.** Sketches on napkins. Knows electronics but
wants a fast sanity check and a clean visual before committing to stripboard.

- **Needs:** speed and an attractive artefact to share.

### 2.4 Non-users (explicitly)

- Professional PCB designers — they have Altium and KiCad, and their input is not a sketch.
- IC designers — wrong abstraction level entirely.
- Anyone needing manufacturing output — this produces understanding, not gerbers.

---

# 3. User stories

### 3.1 Must have (P0)

| ID | Story | Acceptance criteria |
|---|---|---|
| **US-01** | As a beginner, I photograph my sketch and see it digitised, so I do not have to re-enter it into a simulator. | Upload or camera capture accepted; components and connections identified; result in <15s. |
| **US-02** | As a beginner, I see my circuit in 3D so I can recognise it as *my* circuit. | Components match what was drawn; topology is visually traceable; renders at ≥50fps. |
| **US-03** | As a beginner, I am told what is wrong in plain language, so I understand the problem rather than just seeing an error code. | Each finding names the component, states the consequence, and gives a concrete fix. |
| **US-04** | As a beginner, I can click any component to inspect it, so I can confirm the system read it correctly. | Click selects; inspector shows type, value, connections; selection is visually obvious. |
| **US-05** | As a beginner, I can change a component's value and immediately see whether that fixes the problem. | Value edit triggers re-analysis in <2s; findings update without a full re-render. |
| **US-06** | As a user, when the system is unsure, it tells me rather than guessing silently. | Confidence below threshold surfaces a visible warning per stage. |
| **US-07** | As a user, I can correct a misidentified component, so one vision error does not invalidate the whole analysis. | Inspector allows type change; graph and analysis update. |

### 3.2 Should have (P1)

| ID | Story |
|---|---|
| **US-08** | As a user, I can rotate/orbit the board to inspect it from any angle. |
| **US-09** | As a user, I see current flowing through the circuit when it is valid. |
| **US-10** | As a user, I can delete a component and see the consequence. |
| **US-11** | As a user, I can add a component the system missed. |
| **US-12** | As a user, I can export the netlist so I can take it to a real simulator. |

### 3.3 Could have (P2)

| ID | Story |
|---|---|
| **US-13** | As a user, I can share a link to my analysed circuit. |
| **US-14** | As an instructor, I can batch-upload 60 sketches and get a triage list. |
| **US-15** | As a user, I can drag components to reposition them. |

### 3.4 Won't have (v1)

PCB layout or routing · SMD components · multi-page schematics · AC/transient
analysis · KiCad export · user accounts · persistence across sessions · collaborative
editing · mobile-native app.

---

# 4. Phase 0 — Feasibility gate

**This section blocks all others. Nothing in §5 onward is built until this passes.**

**Budget: 90 minutes. Hard decision point: 00:00 IST tonight (2–3 Nov).**

### 4.1 Why this exists

Connectivity recovery — determining which wire touches which pin on a messy hand
drawing — is the stage that forced every published system in this space
(Sketch2Sim, Img2Sim-V2) to train custom detectors. It is the single assumption
this product rests on. If a general vision model cannot do it, the product is not
buildable in the time available, and that must be discovered in 90 minutes rather
than 30 hours.

### 4.2 Test corpus

Ten sketches, photographed on a phone in realistic conditions — shadows, lined or
ruled paper, natural handwriting, no retouching.

| Count | Difficulty | Content |
|---|---|---|
| 3 | Easy | Battery + resistor + LED, series only, clean lines |
| 4 | Medium | One parallel branch, a switch, a capacitor, labelled values |
| 3 | Hard | Natural messy style, crossing wires, cramped layout |

### 4.3 Ground truth format

`truth/NN.json` for each sketch:

```json
{
  "components": [
    {"id": "B1", "type": "battery",  "value": "9",   "unit": "V"},
    {"id": "R1", "type": "resistor", "value": "220", "unit": "ohm"},
    {"id": "D1", "type": "led",      "value": "red", "unit": null}
  ],
  "nets": [
    ["B1.pos", "R1.a"],
    ["R1.b", "D1.anode"],
    ["D1.cathode", "B1.neg"]
  ]
}
```

### 4.4 Measurement — three stages, scored independently

Stage-level scoring tells you *where* it breaks, which determines the fix.

| Stage | Metric | Pass bar |
|---|---|---|
| **Component ID** | Correct type and count, F1 against truth | ≥90% |
| **Connectivity** | Exact net-set match after canonicalisation | ≥6 of 7 clean sketches |
| **Value reading** | String match after unit normalisation | ≥80% |

### 4.5 Two pipeline variants — run both

| Variant | Pipeline | Question answered |
|---|---|---|
| **A** | image → Muse Spark directly | Baseline capability |
| **B** | image → SAM 3.1 masks → per-mask crops → Muse Spark | Does SAM add measurable value? |

> **Critical:** if A ≈ B, SAM 3.1 is not load-bearing, and 25% of the hackathon
> score ("creative use of Meta tooling") is exposed. In that case restructure so
> SAM does something variant A structurally cannot — per-component crop isolation
> for value OCR, or wire-trace mask extraction feeding a deterministic graph walk.
> **Discover this tonight, not Wednesday.**

### 4.6 Gate decision table

| Outcome | Decision | Action |
|---|---|---|
| Components ≥90%, connectivity ≥6/7 clean | **GO** | Proceed to §5 |
| Components good, connectivity 50–85% | **NARROW** | Constrain input: printed template or grid paper; series + single-parallel topologies only; ship with stated constraints |
| Connectivity <50% on clean sketches | **ABANDON** | Switch to fallback idea tonight |

### 4.7 Fallback if abandoned

Paper-ledger digitisation (photograph a handwritten shop credit ledger → structured
books → voice query). Same perception stack, same verification framing, far lower
connectivity risk. Documented as a deliberate alternative, not a panic move.

---

# 5. Functional requirements

## 5.1 Capture

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Accept image upload via file picker | P0 |
| FR-1.2 | Accept drag-and-drop onto the canvas | P0 |
| FR-1.3 | Accept camera capture on mobile (`<input capture>`) | P0 |
| FR-1.4 | Accept JPEG, PNG, HEIC, WebP | P0 |
| FR-1.5 | Reject files >10MB with a clear message | P0 |
| FR-1.6 | Downscale client-side to max 2048px longest edge before upload | P0 |
| FR-1.7 | Show a thumbnail of the submitted image alongside the 3D result | P1 |
| FR-1.8 | Offer 3 bundled sample sketches for judges who have no paper to hand | **P0 — the judge will not draw a circuit** |

## 5.2 Perception

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Segment the image into component and wire regions via SAM 3.1 | P0 |
| FR-2.2 | Classify each segment into a supported component type | P0 |
| FR-2.3 | Read handwritten values and units adjacent to each component | P0 |
| FR-2.4 | Recover the net list (which pins are electrically connected) | P0 |
| FR-2.5 | Return per-stage confidence scores | P0 |
| FR-2.6 | Infer component polarity/orientation where it matters (LED, electrolytic, battery, diode) | P0 |
| FR-2.7 | Degrade gracefully: return partial results with explicit gaps rather than failing | P0 |
| FR-2.8 | Complete within 15s p95 | P0 |

### Supported component types (detection)

**Tier 1 (must detect):** resistor, LED, battery/supply, wire/junction, ground.
**Tier 2 (should detect):** capacitor (ceramic, electrolytic), switch, diode, potentiometer.
**Tier 3 (nice to detect):** transistor (BJT), IC/DIP, inductor, crystal, header pins, buzzer, motor.

## 5.3 Analysis

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Convert the recovered graph to a SPICE-compatible netlist | P0 |
| FR-3.2 | Run DC operating-point analysis | P0 |
| FR-3.3 | Compute per-component current, voltage drop, and power dissipation | P0 |
| FR-3.4 | Execute the rule-check suite (§5.4) | P0 |
| FR-3.5 | Return findings with severity, component reference, explanation, and fix | P0 |
| FR-3.6 | Handle unsimulatable graphs (floating nodes, shorts) without crashing | P0 |
| FR-3.7 | Re-run analysis on component edit within 2s | P0 |

## 5.4 Rule checks

Ship at least these five. **The quality of the sentence matters more than the number
of checks** — the sentence is what a judge reads and what a beginner learns from.

| # | Check | Severity | Example message |
|---|---|---|---|
| 1 | LED without series current limiting | Error | "D1 has no current-limiting resistor. At 9V it will draw roughly 450mA — about 20× its rating — and fail within seconds. Add a 330Ω resistor in series." |
| 2 | Electrolytic capacitor reverse-polarised | Error | "C1 is connected backwards. Electrolytic capacitors vent or rupture when reverse-biased. Flip it so the stripe faces ground." |
| 3 | Short circuit across supply | Error | "B1's terminals are connected with no load between them. This is a dead short and will overheat the battery." |
| 4 | Floating / unconnected pin | Warning | "R2's lower lead connects to nothing. This branch carries no current." |
| 5 | Resistor power rating exceeded | Warning | "R1 dissipates 0.6W but standard through-hole resistors are rated 0.25W. It will run hot and drift. Use a 1W part." |

**Extended set (P1):** missing flyback diode on an inductive load, no decoupling
capacitor near an IC supply pin, transistor base without a resistor, supply voltage
exceeding a component's rating, no pull-up on a floating logic input.

## 5.5 Rendering

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Render each component as a recognisable 3D object | P0 |
| FR-5.2 | Lay out components from the net graph, no overlap, readable topology | P0 |
| FR-5.3 | Render wires as tubes following routed paths | P0 |
| FR-5.4 | Maintain ≥50fps on a mid-range laptop, ≥30fps on mobile | P0 |
| FR-5.5 | Orbit, pan, and zoom the camera | P0 |
| FR-5.6 | Visually highlight faulted components | P0 |
| FR-5.7 | Play the assembly animation on first render | P0 |
| FR-5.8 | Render correctly at viewport widths from 360px to 2560px | P0 |
| FR-5.9 | Animate current flow along wires when the circuit is valid | P1 |

## 5.6 Interaction

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | Hover highlights the component under the cursor | P0 |
| FR-6.2 | Click selects; selection is unambiguous visually | P0 |
| FR-6.3 | Inspector panel shows type, value, unit, connections, computed current/voltage/power | P0 |
| FR-6.4 | Edit a component's value; analysis re-runs | P0 |
| FR-6.5 | Change a component's type (correct a vision error); analysis re-runs | P0 |
| FR-6.6 | Delete a component; analysis re-runs | P1 |
| FR-6.7 | Escape or click-away deselects | P0 |
| FR-6.8 | Clicking a finding selects and focuses the implicated component | P0 |
| FR-6.9 | Touch targets ≥44px; selection works by tap on mobile | P0 |

---

# 6. Technical architecture

## 6.1 System diagram

```
┌─────────────────────────────────────────────────────────┐
│ BROWSER (single page, no build step)                    │
│                                                         │
│  capture.js ──► POST /analyze ──────────────┐           │
│                                             │           │
│  ┌──────────────────────────────────────┐   │           │
│  │ scene.js    — renderer, IBL, camera  │   │           │
│  │ components.js — procedural geometry  │   │           │
│  │ layout.js   — graph → 3D positions   │ ◄─┤           │
│  │ wires.js    — routing + tubes        │   │           │
│  │ picking.js  — raycast, selection     │   │           │
│  │ inspector.js— panel, edits           │───┤           │
│  │ anim.js     — assembly, pulse, flow  │   │           │
│  └──────────────────────────────────────┘   │           │
└─────────────────────────────────────────────┼───────────┘
                                              │
┌─────────────────────────────────────────────▼───────────┐
│ FASTAPI SERVER (main.py)                                │
│                                                         │
│  /analyze ──► vision.py ──► SAM 3.1   (Meta Model API)  │
│                        └──► Muse Spark (Meta Model API) │
│           └──► graph.py  ──► canonicalise, validate     │
│           └──► spice.py  ──► netlist → ngspice          │
│           └──► rules.py  ──► findings                   │
│                                                         │
│  /simulate ─► spice.py + rules.py  (edit path, no vision)│
└─────────────────────────────────────────────────────────┘
```

## 6.2 Stack decisions — made, not open

### 6.2.1 3D: Three.js, vanilla, no framework wrapper

**Decision: Three.js r16x via ES module importmap. No React Three Fiber. No Babylon. No raw WebGL.**

| Option | Verdict | Reason |
|---|---|---|
| **Three.js vanilla** | ✅ **Chosen** | Mature, enormous reference surface, direct scene-graph mutation suits this app's model |
| React Three Fiber | ❌ | Adds a React reconciler for no gain — there is no complex state tree, just a scene graph. Every component becomes JSX wrapper code: pure token cost. |
| Babylon.js | ❌ | Heavier bundle, more verbose material API for identical output |
| Raw WebGL | ❌ | Hand-written shaders, matrix math, and picking. That is a week, not a night. |

### 6.2.2 Geometry: procedural, not modelled or downloaded

**This is the most important technical decision in this document.**

Do not source `.glb` assets. Do not hand-author meshes. Every through-hole
electronic component is a trivial parametric solid, and generating them in code
is both higher quality and dramatically cheaper.

**Why procedural wins here:**

1. **Breadth becomes achievable.** One `components.js` (~300 lines) generates the
   entire library. A new type costs ~10 lines. "Supports every component type"
   stops being aspirational.
2. **Token economy.** No asset pipeline, no model conversion, no texture authoring.
3. **Zero load time.** No CDN asset fetch, no loading spinner, instant first paint.
4. **Parametric correctness.** A 220Ω resistor renders with red-red-brown bands
   because the bands are computed from the value. A downloaded mesh cannot do that.
5. **Consistent art direction.** Every component shares the same material language,
   so nothing looks pasted in from a different asset pack.

**Quality comes from materials and light, not polygon count.** A procedural
resistor with correct roughness, a clearcoat layer, and proper IBL looks better
than a 10k-triangle download under flat lighting. This is the thing most WebGL
component viewers get wrong, and it is why they look sloppy.

### 6.2.3 Component construction reference

| Component | Construction |
|---|---|
| Resistor | `CylinderGeometry` body, radius taper at ends, 4 band cylinders (colours computed from value), 2 lead cylinders |
| Capacitor (ceramic) | Flattened sphere / lozenge + 2 leads |
| Capacitor (electrolytic) | Capped cylinder + sleeve + polarity stripe via vertex colour + asymmetric lead lengths |
| LED | Hemisphere + cylinder flange + flat side cut + inner emissive core + anode/cathode leads of different length |
| Diode | Cylinder + cathode band + leads |
| Battery | Cylinder + positive terminal nub + wrap texture via vertex colour |
| Switch (SPST) | Box base + pivoting lever `Group` + 2 contacts |
| Potentiometer | Cylinder body + shaft + knurled knob (`CylinderGeometry` with radial segment displacement) |
| Transistor (TO-92) | Cylinder with one face clipped flat + 3 splayed legs |
| IC (DIP) | `BoxGeometry` + pin-1 dimple (`CircleGeometry`) + `InstancedMesh` legs |
| Inductor | `TubeGeometry` along a helical `CatmullRomCurve3` + core |
| Crystal | Rounded box + 2 leads |
| Header pins | Single `InstancedMesh` of boxes |
| Buzzer | Cylinder + top vent hole (`RingGeometry`) |
| Motor | Cylinder body + shaft + end caps |

### 6.2.4 Materials and lighting — the "not sloppy" requirement

**Materials:** `MeshPhysicalMaterial` throughout, with a defined material class per
physical substance:

| Material class | roughness | metalness | Other |
|---|---|---|---|
| Ceramic body | 0.70 | 0.0 | subtle clearcoat 0.2 |
| Epoxy (LED dome) | 0.05 | 0.0 | transmission 0.9, ior 1.5, thickness 2 |
| Tinned lead | 0.25 | 1.0 | — |
| Plastic (IC, switch) | 0.45 | 0.0 | clearcoat 0.3 |
| FR4 board | 0.80 | 0.0 | — |
| Painted metal (battery) | 0.35 | 0.6 | clearcoat 0.5 |

**Lighting — image-based lighting is mandatory, not optional:**

```js
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

Three lines. This is the entire difference between "renders" and "looks real,"
and it requires no HDRI download.

**Renderer configuration:**

```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
```

One `DirectionalLight` with a 2048 shadow map for contact shadows. The IBL does
everything else. **Do not stack point lights** — that is the hallmark of amateur
WebGL and it will look worse, not better.

**Postprocessing:** none in v1, except optional `UnrealBloomPass` restricted to LED
emissive when lit, and only if the frame budget allows. Selection outline uses a
scaled back-face shell rather than `OutlinePass` — cheaper, and avoids pulling in
the whole composer chain.

### 6.2.5 Animation

Hand-rolled easing over a dependency — `lerp` plus `easeOutCubic` is ~10 lines and
avoids a 60KB GSAP import.

| Animation | Spec |
|---|---|
| **Assembly ("the money shot")** | Components fade in, scale 0.85 → 1.0, opacity 0 → 1, staggered 80ms in net order so the circuit visibly assembles itself. Total ~1.2s. |
| **Wire draw-on** | `TubeGeometry` with animated `drawRange`, following each component's appearance |
| **Fault pulse** | `emissiveIntensity = 0.3 + 0.25 * sin(t * 3)` on the offending component, plus a floating annotation sprite |
| **Selection** | Back-face shell scales 1.0 → 1.04 over 120ms |
| **Camera focus** | Smooth `lerp` of target and position over 400ms when a finding is clicked |
| **Current flow (P1)** | Animated texture offset on wire tubes, speed proportional to current magnitude |

### 6.2.6 Remaining stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Single HTML + ES modules, importmap | No build step, no toolchain time cost |
| Three.js | `cdn.jsdelivr.net/npm/three@0.17x` | Allowlisted, reliable |
| Backend | Python 3.11 + FastAPI, single `main.py` | Fast to write, async for model calls |
| Vision | SAM 3.1 + Muse Spark via Meta Model API | Required by the hackathon; load-bearing by design |
| Simulation | `ngspice` subprocess, or PySpice | Industry standard, trivially scriptable |
| Transport | JSON over `POST /analyze`, `POST /simulate` | No streaming complexity in v1 |

## 6.3 File structure

```
/
├── index.html              # shell, importmap, canvas, panels
├── css/style.css
├── js/
│   ├── main.js             # bootstrap, wiring
│   ├── scene.js            # renderer, IBL, camera, controls, loop
│   ├── components.js       # procedural geometry factory  ← the core
│   ├── materials.js        # material class definitions
│   ├── layout.js           # net graph → 3D positions
│   ├── wires.js            # routing + tube generation
│   ├── picking.js          # raycast, hover, selection
│   ├── inspector.js        # panel, edit handlers
│   ├── anim.js             # easing, assembly, pulse
│   └── api.js              # fetch wrappers, error states
├── server/
│   ├── main.py             # FastAPI app, routes
│   ├── vision.py           # SAM 3.1 + Muse Spark calls
│   ├── graph.py            # canonicalisation, validation
│   ├── spice.py            # netlist generation, ngspice
│   └── rules.py            # rule-check suite
├── samples/                # 3 bundled sketches for judges
├── truth/                  # Phase 0 ground truth
├── test_feasibility.py     # Phase 0 scoring harness
├── .env.example            # key names only — never commit real keys
└── README.md
```

## 6.4 Development environment setup

There are **two separate places** a Meta API key is used in this project. Do not
conflate them.

### 6.4.1 Claude Code pointed at Meta's models (the coding assistant)

This routes Claude Code itself through Meta's API, so Muse writes the code. It has
no effect on what the shipped application calls at runtime.

```bash
export MODEL_API_KEY="<your-key>"
export ANTHROPIC_BASE_URL="https://api.meta.ai"
export ANTHROPIC_AUTH_TOKEN="$MODEL_API_KEY"
export ANTHROPIC_MODEL="muse-wonder-1.0"
export ANTHROPIC_DEFAULT_OPUS_MODEL="muse-wonder-1.0"
export ANTHROPIC_DEFAULT_SONNET_MODEL="muse-wonder-1.0"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="muse-wonder-1.0"
export CLAUDE_CODE_SUBAGENT_MODEL="muse-wonder-1.0"
export ENABLE_TOOL_SEARCH="true"
```

Put these in a shell profile or a sourced `.envrc` so they survive new terminal
sessions. Verify the routing works before relying on it — a failed auth here looks
like a normal model error, not a config error.

**Budget note:** this consumes the same $150 of Model API credits the application
needs. Coding tokens and Phase 0 test runs come out of one pot. If credits get
tight, the application's runtime calls take priority over the coding assistant.

### 6.4.2 The application's own runtime calls (`server/vision.py`)

`vision.py` calls SAM 3.1 and Muse Spark directly. It does **not** inherit the
variables above — those configure a different client. Read the key from the
environment at startup and fail loudly if absent:

```python
import os
MODEL_API_KEY = os.environ["MODEL_API_KEY"]   # KeyError at boot beats a 401 mid-demo
```

`.env.example` lists key *names* only. Add `.env` to `.gitignore` before the first
commit. **The repository is a submission artefact and will be read by judges — a
leaked key is both a security problem and a bad look.**

### 6.4.3 Local prerequisites

| Dependency | Install | Verify |
|---|---|---|
| Python 3.11+ | system | `python3 --version` |
| FastAPI + Uvicorn | `pip install fastapi uvicorn python-multipart` | — |
| ngspice | `brew install ngspice` / `apt install ngspice` | `ngspice --version` |
| HTTP client | `pip install httpx` | — |
| Static server | `python3 -m http.server 8080` | — |

No Node toolchain, no bundler, no build step. Three.js loads from CDN via importmap.

---

# 7. Data contracts

## 7.1 `POST /analyze`

**Request:** `multipart/form-data` with field `image`.

**Response 200:**

```json
{
  "circuit_id": "c_8f3a21",
  "confidence": {
    "components": 0.94,
    "connectivity": 0.81,
    "values": 0.88
  },
  "components": [
    {
      "id": "R1",
      "type": "resistor",
      "value": "220",
      "unit": "ohm",
      "orientation": null,
      "bbox": [120, 340, 80, 30],
      "mask_id": 3,
      "confidence": 0.91,
      "pins": ["a", "b"]
    },
    {
      "id": "D1",
      "type": "led",
      "value": "red",
      "unit": null,
      "orientation": "anode_left",
      "bbox": [260, 335, 50, 40],
      "mask_id": 5,
      "confidence": 0.87,
      "pins": ["anode", "cathode"]
    }
  ],
  "nets": [
    {"id": "N1", "pins": ["B1.pos", "R1.a"]},
    {"id": "N2", "pins": ["R1.b", "D1.anode"]},
    {"id": "N3", "pins": ["D1.cathode", "B1.neg"], "is_ground": true}
  ],
  "simulation": {
    "status": "ok",
    "node_voltages": {"N1": 9.0, "N2": 2.1, "N3": 0.0},
    "component_results": {
      "R1": {"current_a": 0.031, "voltage_v": 6.9, "power_w": 0.214},
      "D1": {"current_a": 0.031, "voltage_v": 2.1, "power_w": 0.065}
    }
  },
  "findings": [
    {
      "id": "f1",
      "severity": "warning",
      "component_id": "R1",
      "rule": "power_rating_exceeded",
      "message": "R1 dissipates 0.21W. Standard through-hole resistors are rated 0.25W, so this runs close to its limit and will get warm.",
      "fix": "Use a 0.5W resistor, or raise the resistance to 470Ω."
    }
  ],
  "warnings": [
    "Connectivity confidence is below 0.85 — verify the connections marked uncertain."
  ]
}
```

**Note:** 3D positions are **computed client-side** from the net graph. Never ask
the model for coordinates — it will produce plausible-looking nonsense.

## 7.2 `POST /simulate`

Used by the edit path. Takes the current graph, skips all vision work, returns
`simulation` + `findings` only. Target <2s.

## 7.3 Error responses

| Code | Condition | User-facing message |
|---|---|---|
| 400 | Unsupported file type | "That file type isn't supported. Try a JPEG or PNG." |
| 413 | File >10MB | "That image is too large. Try one under 10MB." |
| 422 | No circuit detected | "I couldn't find a circuit in that image. Try a clearer photo with better lighting." |
| 429 | Model API rate limit | "Too many requests right now. Try again in a moment." |
| 500 | Model API failure | "Something went wrong analysing that. Try again." |
| 504 | Analysis exceeded 30s | "That took too long. Try a simpler sketch or a clearer photo." |

**Partial-result principle:** if components are found but connectivity fails, return
200 with the components, an empty `nets` array, and an explicit warning. Never
discard good partial work because one stage failed.

---

# 8. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Analysis latency | p50 <8s, p95 <15s |
| NFR-2 | Edit re-simulation latency | <2s |
| NFR-3 | Render framerate, desktop | ≥50fps at 1080p |
| NFR-4 | Render framerate, mobile | ≥30fps |
| NFR-5 | Time to first paint | <1.5s |
| NFR-6 | Total JS payload | <600KB including Three.js |
| NFR-7 | Viewport support | 360px – 2560px |
| NFR-8 | Browser support | Chrome, Safari, Firefox — current and previous major |
| NFR-9 | Keyboard navigation | Tab through components; Enter selects; Escape deselects |
| NFR-10 | Colour independence | Faults indicated by icon + text, never colour alone |
| NFR-11 | Reduced motion | Respect `prefers-reduced-motion`: skip assembly animation, no pulse |
| NFR-12 | Graceful WebGL failure | If WebGL is unavailable, show the findings list without the 3D view |

---

# 9. Build plan

| # | Task | Output | Gate |
|---|---|---|---|
| **0** | **Feasibility test (§4)** | Stage scores, GO/NARROW/ABANDON | **Must pass by 00:00 IST** |
| 1 | `POST /analyze` returning hardcoded JSON | Frozen contract | Frontend unblocked |
| 2 | Three.js scene: board, IBL, camera, orbit | Empty board renders | Looks good with nothing on it |
| 3 | `materials.js` + `components.js` — resistor, LED, battery, wire | 4 types render | Art direction locked |
| 4 | `layout.js` + `wires.js` — graph → scene | Hardcoded circuit renders | Topology readable |
| 5 | Wire in real vision pipeline | Real photo → 3D | **End-to-end exists** |
| 6 | `spice.py` + `rules.py` | A finding appears | Core value proposition live |
| 7 | `picking.js` + `inspector.js` + edit → re-sim | Tweak updates finding | **US-05 satisfied** |
| 8 | `anim.js` — assembly, fault pulse | Demo-ready | **Submittable** |
| 9 | Remaining Tier 2/3 component types | Breadth | Breadth claim earned |
| 10 | **Demo video + README** | Submission artefacts | **Non-negotiable** |

**Steps 1–8 constitute the submission. Steps 9–10 are what wins it.**

If time runs short, cut component breadth (step 9). **Never cut step 10** — the
demo is 25% of the score, equal to the entire Meta-tooling criterion, and a
polished video of a narrow product beats a rough video of a broad one.

### 9.1 Parallelisable work

`spice.py` and `rules.py` (step 6) have **zero dependency on the Meta API** and can
be built while Phase 0 is still undecided. If the gate fails, this work transfers
to nothing — but it is also the least risky place to spend time while waiting on
vision results.

---

# 10. Demo script (plan this now, not Wednesday)

Target: 2 minutes 30 seconds.

| Time | Content |
|---|---|
| 0:00–0:15 | **Hook.** Hand holding a paper sketch. "I drew this circuit. Is it going to work?" Photograph it. |
| 0:15–0:35 | Upload → analysis → **the assembly animation**. Circuit builds itself in 3D. No narration; let it land. |
| 0:35–1:00 | Orbit the board. Click the resistor. Inspector shows current, voltage, power. "It read my handwriting." |
| 1:00–1:30 | **The reveal.** LED pulses red. Finding: no current-limiting resistor, will draw 450mA, will fail. |
| 1:30–1:55 | **The fix.** Change the resistor value in the inspector. Finding clears live. Circuit goes green. |
| 1:55–2:20 | Technical: SAM 3.1 segmentation overlay, Muse Spark connectivity recovery, SPICE netlist. Name the Meta tools explicitly. |
| 2:20–2:30 | Close on the 3D board. One sentence on what this is for. |

**Rules:** no slides. No talking head. Screen and hands only. The first 20 seconds
decide whether a judge watches the rest.

---

# 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Connectivity recovery fails on messy sketches | **High** | **Fatal** | Phase 0 gate at 00:00 IST; NARROW fallback to constrained input; ABANDON path defined |
| SAM 3.1 adds no measurable value over Muse Spark alone | Medium | High (25% of score) | Variant A/B test in Phase 0; restructure so SAM does crop isolation or wire-trace extraction |
| 3D work consumes the whole budget | Medium | High | Procedural geometry caps the cost; steps 2–4 are time-boxed; breadth is step 9 and cuttable |
| SPICE integration proves fiddly | Medium | Medium | Rule checks (§5.4) work on the graph alone and do not require simulation — ship those first |
| Meta Model API rate limits or outages | Low | High | Cache Phase 0 responses; bundled sample sketches have pre-baked results as a demo fallback |
| Running out of time for the video | Medium | **High** | Step 10 is non-negotiable; hard stop on features Wednesday 02:00 IST |
| IP/ownership clause conflicts with reuse plans | Unknown | Medium | Verify before writing code (§13) |

---

# 12. Success metrics

### Hackathon outcome (primary)

- Submitted before 05 Nov 06:30 IST with a complete video and README
- End-to-end flow works on an unseen sketch, live, without a retry

### Product quality (measurable)

| Metric | Target |
|---|---|
| Component detection accuracy on the Phase 0 corpus | ≥90% |
| Connectivity accuracy on clean sketches | ≥85% |
| Rule-check true positive rate on hand-built faulty circuits | 100% on the 5 shipped rules |
| Analysis p95 latency | <15s |
| Desktop framerate | ≥50fps |

### Qualitative bar

A person who has never used a circuit simulator photographs their sketch and,
within 30 seconds and without instruction, understands something true about their
circuit that they did not know before.

---

# 13. Open questions — resolve before writing code

- [ ] **Does the hackathon permit starting from existing code?** Determines whether
      any prior work can be reused.
- [ ] **IP / ownership clause in the Official Rules** — matters more here than for
      most entrants.
- [ ] Required submission artefacts: video length limit, repo visibility, demo URL.
- [ ] Does SAM 3.1 accept thin-line drawings, or does it expect photographic objects?
      (Phase 0 answers this.)
- [ ] Muse Spark context limit for the connectivity prompt with N masks attached.
- [ ] Is `ngspice` installable in the deployment environment, or is PySpice simpler?

---

# 14. Appendix — value-to-colour mapping

Resistor bands are computed from the value, not authored. Standard E24 colour code:

| Digit | Colour | Hex |
|---|---|---|
| 0 | Black | `#1a1a1a` |
| 1 | Brown | `#6b4423` |
| 2 | Red | `#c62828` |
| 3 | Orange | `#ef6c00` |
| 4 | Yellow | `#f9a825` |
| 5 | Green | `#2e7d32` |
| 6 | Blue | `#1565c0` |
| 7 | Violet | `#6a1b9a` |
| 8 | Grey | `#757575` |
| 9 | White | `#eeeeee` |
| Tolerance ±5% | Gold | `#c9a227` |
| Tolerance ±10% | Silver | `#b0b0b0` |

220Ω → red, red, brown, gold. This is the kind of detail that makes a judge believe
the rest of the product.
