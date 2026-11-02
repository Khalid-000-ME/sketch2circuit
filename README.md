# Sketch → Circuit

**Photograph a hand-drawn circuit. Find out if it works.**

A beginner draws a circuit on paper, photographs it, and within seconds sees it
assemble itself in 3D — real components, real materials, real light — with a red
pulse on the LED they were about to destroy, a sentence explaining why, and a
concrete fix.

Digitisation is the plumbing. **The review is the product.**

---

## The problem

Electronics education has a brutal feedback loop. A beginner draws a circuit,
builds it, and finds out it was wrong when something gets hot, releases smoke, or
silently does nothing.

Existing tools do not close it. Simulators require you to already know how to
express the circuit in their language — the sketch on your paper is not the
input. Research pipelines convert sketches to netlists and stop at digitisation:
they tell you what you drew, not whether it is sane. Text-to-schematic tools run
the opposite direction, so the sketch is never an input at all.

Nobody takes the artefact the beginner actually has — a messy drawing on lined
paper — and returns judgement on it.

---

## How it works

```
  photo
    │
    ├─ 1. Muse Spark reads the whole page ──────────────────────────────┐
    │     what symbols are here, roughly where, what is written on them,│
    │     and which noun phrases are worth segmenting                   │
    │                                                                   │
    ├─ 2. SAM 3.1 segments each of those concepts ──────────────────────┤
    │     one request per concept, boxes + pixel-accurate masks out     │
    │                                                                   │
    ├─ 3. SAM's boxes replace Spark's estimates ────────────────────────┤
    │     a mask boundary is exact; a described box is not              │
    │                                                                   │
    ├─ 4. the wire mask is WALKED, not interpreted ─────────────────────┤
    │     connected-components labelling over the drawn lines           │
    │                                                                   │
    ├─ 5. each symbol is cropped from its own mask and re-read ─────────┘
    │     a handwritten "220" read from a frame it fills
    │
    ├─ 6. DC operating point: modified nodal analysis, Newton-Raphson
    │
    └─ 7. rule checks → findings in plain language
              │
              └─ 3D board: procedural geometry, IBL, faults pulse
```

### Both Meta models are load-bearing

Remove either one and a numbered step above has no replacement.

- **Muse Spark cannot produce pixels.** It cannot give you a mask to walk, and it
  cannot isolate a symbol so its label can be read in close-up.
- **SAM 3.1 cannot decide what to look for.** It takes a noun phrase; something
  has to know that this page contains a zigzag resistor symbol and a battery
  symbol and drawn wire lines, and that one of them is worth segmenting
  separately so connectivity can be recovered geometrically.

The pairing is the architecture, not a checkbox.

### Connectivity is recovered deterministically

Deciding which wire touches which lead is the stage that forced every published
system in this space to train a custom detector, and it is the one thing this
project refuses to ask a language model to guess.

Given SAM's pixel-accurate wire mask, connectivity stops being a judgement call
and becomes a connected-components problem ([`src/lib/pipeline/trace.ts`](src/lib/pipeline/trace.ts)):

1. rasterise every wire mask into one binary grid;
2. punch out the component symbols, so a symbol *separates* the lines it joins
   instead of bridging them;
3. close pencil gaps with a small dilation;
4. label the connected regions;
5. place each component's pins geometrically and attach each to the region it
   touches.

Pins in the same region are the same electrical node. Nothing is probabilistic,
so the same sketch always yields the same netlist — and when a pin touches
nothing, the app says so rather than inventing a wire.

If the trace covers fewer than 75% of leads, the app falls back to the model's
own netlist **and says so**, in the confidence panel and in a warning.

---

## What it tells you

Five shipped rule checks, plus an extended set. The quality of the sentence
matters more than the number of checks — the sentence is what a beginner learns
from.

| Check | Severity |
|---|---|
| LED with no current-limiting resistor | Error |
| Electrolytic capacitor reverse-polarised | Error |
| Short circuit across the supply | Error |
| Floating / unconnected pin | Warning |
| Resistor power rating exceeded | Error / Warning |
| LED fitted backwards · inductive load with no flyback diode · transistor base with no resistor · implausible supply voltage · value unreadable · device outside the DC model | Error → Note |

A real finding, from the bundled sample:

> **D1 has no current-limiting resistor.** At 9V it will draw roughly 438mA —
> about 22× its 20mA rating — and fail within seconds.
> **Fix:** Add a 470Ω resistor in series with D1.

That 438mA is not a guess. The LED model carries a bulk series resistance and the
battery an internal resistance, because those two quantities are what actually
limit the current when you put an LED straight across a 9V cell.

---

## The simulator

A modified-nodal-analysis DC solver with a Newton-Raphson loop for the nonlinear
devices, written in TypeScript ([`src/lib/circuit/solve.ts`](src/lib/circuit/solve.ts)).
It replaces the usual `ngspice` subprocess, which buys two things:

- **no native binary in the deploy target** — it runs anywhere Node runs;
- **the edit path answers in milliseconds.** Changing a resistor value and
  watching the finding clear is measured at **16ms**, not the 2s the spec asked
  for. That is the difference between turning a knob and submitting a form.

It implements SPICE's `pnjlim` junction limiting, a `gmin` conductance to ground
for conditioning, internal nodes for diode bulk resistance, and convergence that
requires *no device was limited on the final iteration* — without that last
condition the loop happily declares victory while a diode is still travelling.

Unsimulatable graphs (floating nodes, dead shorts, no source) degrade to a stated
reason plus the rule checks that do not need a solution, rather than an error.

---

## The renderer

Three.js, vanilla, no framework wrapper. **Every component is generated in code**
([`src/three/components.ts`](src/three/components.ts)) — nothing is modelled or
downloaded. A new component type costs about ten lines, which is why the library
covers eighteen types rather than four.

The decisive consequence is that parts are built *from their values*: a 220Ω
resistor renders with red-red-brown-gold bands because the bands are computed
from the resistance, and an electrolytic's can grows with its capacitance. A
downloaded mesh cannot do that.

Quality comes from materials and light, not polygon count: `MeshPhysicalMaterial`
with a defined class per physical substance, and image-based lighting from
`RoomEnvironment` through a PMREM generator — three lines, no HDRI download, and
the entire difference between "this renders" and "this looks real". One
directional light for contact shadows. No stacked point lights.

Other decisions worth knowing:

- Positions are computed client-side by force-directed relaxation over the net
  graph, seeded deterministically so a circuit always lays out the same way. The
  model is never asked for coordinates — it would return plausible-looking
  nonsense.
- Layout extents are **measured from the built geometry**, not declared, so a
  part can never claim less board than it occupies.
- Materials are shared by substance to keep draw calls down, but each component's
  highlightable bodies get their own clone — otherwise pulsing one faulty
  resistor would light every resistor on the board.
- Selection uses a scaled back-face shell rather than an `OutlinePass`, avoiding
  the whole composer chain.
- Current flow is a dash texture scrolling at a speed set by the solved current,
  on a log scale, so a 1mA branch visibly creeps next to a 500mA one.
- `prefers-reduced-motion` skips the assembly animation and freezes the pulse.

---

## Running it

```bash
npm install
cp .env.example .env.local     # then add your key, see below
npm run dev                    # http://localhost:3000
```

### The API key

The app calls the Meta Model API at runtime. Get a key from
[dev.meta.ai](https://dev.meta.ai) and put it in `.env.local`:

```
MODEL_API_KEY=your-key-here
```

`.env.local` is gitignored. **This repository is a submission artefact and will be
read by judges — never commit a key.**

Without a key the app still runs: the three bundled sample sketches serve cached
results, computed by the same solver and rule suite the live path uses, so they
can never drift from real output. Only the perception stage is pre-supplied.

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_API_KEY` | — | **Required** for live analysis |
| `META_BASE_URL` | `https://api.meta.ai/v1` | API base |
| `SPARK_MODEL` | `muse-spark-1.3` | Reasoning and value reading |
| `SAM_MODEL` | `sam-3.1` | Segmentation |

### Cost per analysis

One Spark page read, one SAM call per concept (up to six), and one Spark call per
component crop. At list prices that is a few cents per sketch; `muse-spark-1.3-contributor`
cuts the Spark share by about 12×.

---

## Project layout

```
src/
├── app/
│   ├── page.tsx                  the whole UI state machine
│   └── api/
│       ├── analyze/route.ts      image in, analysed circuit out
│       └── simulate/route.ts     the edit path — no vision, no model calls
├── lib/
│   ├── types.ts                  the domain, shared by every layer
│   ├── meta/
│   │   ├── client.ts             transport, auth, SSE decoding, error mapping
│   │   ├── sam.ts                SAM 3.1 segmentation and mask rasters
│   │   └── spark.ts              the two Muse Spark prompts
│   ├── pipeline/
│   │   ├── perceive.ts           orchestration: both models into one graph
│   │   ├── trace.ts              deterministic connectivity from wire masks
│   │   └── analyse.ts            canonicalise → solve → judge
│   ├── circuit/
│   │   ├── graph.ts              canonicalisation, net merging, validation
│   │   ├── solve.ts              MNA + Newton-Raphson DC solver
│   │   ├── rules.ts              the rule-check suite
│   │   └── units.ts              handwritten value parsing: "4k7" → 4700
│   └── client/api.ts             fetch wrappers, downscaling, SPICE export
├── three/
│   ├── scene.ts                  renderer, IBL, camera, picking, loop
│   ├── components.ts             procedural geometry — the core
│   ├── materials.ts              one class per physical substance
│   ├── layout.ts                 net graph → 3D positions
│   ├── wires.ts                  routing, tubes, current flow
│   └── anim.ts                   easing and tweens, ~40 lines
└── components/                   Viewer, Capture, Findings, Inspector, …

scripts/
├── engine-test.ts                solver + rules across eight fixtures
├── edit-test.ts                  the edit path, end to end in a browser
├── shot.ts / mobile-shot.ts      screenshots with real WebGL
└── make-samples.ts               regenerates the bundled sketches
```

## Checks

```bash
npx tsx scripts/engine-test.ts    # solver and rules against eight fixtures
npx tsx scripts/edit-test.ts      # edit → re-solve → finding clears, in a browser
npx eslint src scripts
npx tsc --noEmit
```

---

## Honest limitations

- **DC only.** No transient or AC analysis. Capacitors are open circuits and
  inductors are shorts, which is correct for an operating point and useless for
  anything time-varying.
- **Transistors and ICs are drawn and inspected but not simulated.** The app says
  so in a finding rather than quietly reporting zero and letting you assume it
  modelled them.
- **Potentiometer wipers are fixed at 50%.**
- **Switch state is read from the sketch and is editable, but there is no way to
  add a component the vision stage missed** — you can correct a type, change a
  value, or delete a part, not insert one.
- **The bundled sample sketches are generated, not photographed.** They are drawn
  with jittered strokes on ruled paper so the perception stage faces roughly the
  same question a phone photo asks, but they are not a substitute for testing on
  real photographs.
