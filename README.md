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

### Where the trace is silent, the model fills in — it does not take over

The trace keeps authority over structure; the model is consulted only about pins
the trace could not place. A pin the walk missed joins the traced net sharing the
most pins with the model's net for it; only if no traced net overlaps does the
model contribute a net of its own. Every net records its source, confidence
tracks the share of leads actually *measured* rather than inferred, and the
warnings name the specific pins that were inferred.

The earlier all-or-nothing version threw the whole trace away when coverage was
imperfect, which lost verified connections in order to repair unverified ones.
Only below 40% coverage — too little structure to build on — does the model's
netlist get used wholesale.

---

## Measured results

Against the three bundled sketches, through the live API, scored by
`scripts/live-samples.ts` with the hand-built fixtures as ground truth:

| Metric | PRD target | Measured |
|---|---|---|
| Component type accuracy | ≥90% | **100%** (11/11) |
| Exact netlist match after canonicalisation | ≥6 of 7 clean | **3 of 3** |
| Handwritten values read correctly | ≥80% | **6 of 7** (one LED colour left null) |
| Wire-trace lead coverage | — | 100%, 100%, 50% |
| Edit re-simulation | <2s | **21ms** |
| Analysis latency | p95 <15s | **14–37s — misses the target** |

Every finding the rule suite produced on these sketches was correct, and the
circuit that should be flagged was flagged.

### What the live API actually taught us

These are measurements, not guesses, and several contradicted the plan:

- **SAM cannot find a battery by noun phrase.** Six phrasings — "battery
  symbol", "battery", "parallel lines battery symbol", "drawn battery cell
  symbol", "pair of long and short parallel lines", "circuit diagram battery" —
  all returned zero masks for a battery drawn as four thin parallel lines, while
  the same page returned clean masks for the resistor, the LED and the wires.
  This is why components are segmented by **box prompt** rather than by phrase.
- **SAM returns a resistor's zigzag when asked for "drawn wire line"**, which is
  correct — that is what a resistor is drawn as — and ruinous if left in the wire
  grid, because the zigzag becomes a region that captures the resistor's own pin.
  Hence punching each symbol's own mask out of the wire grid.
- **A tight box prompt yields a tight mask.** Prompted with an estimate that
  clipped the zigzag, SAM returned the clipped zigzag; prompted with the same box
  padded, it returned the whole symbol. Prompt boxes are padded 22%.
- **Wire recall depends sharply on wording.** "drawn wire line" finds one sample's
  lower run and misses its upper one; the bare "line" finds the upper one.
  Phrasings are unioned, with a filter for the ruled lines and margin rule that
  "line" also returns.
- **SAM is deterministic; Muse Spark is not.** Five identical SAM requests
  returned byte-identical masks, with and without `temperature: 0`. Spark's
  bounding boxes vary by a few percent run to run *even at `temperature: 0`*,
  and since those boxes drive the prompts and the pin anchors, trace coverage
  moves between runs. Reconciliation is what makes the final netlist stable
  anyway.
- **`reasoning_effort: "high"` is required for the page read.** At `"medium"` the
  same sketches came back with duplicated components, no values at all and
  unusable connectivity — and not faster, since a confused read reasons longer.

### Latency

The page read is essentially the whole cost:

```
spark page read   22.3s   ← reasoning_effort: high, and it has to be
sam wire masks     3.0s   ← runs in parallel with the page read
sam box prompts    2.9s
crop re-reads      2.8s   ← only for values the page read was unsure of
wire trace         0.01s
solve + rules      <0.01s
```

Two things were done about it: the wire segmentation needs nothing from the page
read, so it is started first and overlaps it; and the crop pass now runs only for
components whose value came back empty, whose identification was hesitant, or
whose polarity matters and was not reported. Together those took the simplest
sketch from 25s to 14s. The rest is Spark's reasoning time and is not ours to
optimise.

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
  real photographs. Three sketches is also a thin corpus: the PRD asks for ten,
  across three difficulty bands, and that has not been built.
- **Analysis takes 14–37 seconds, against a 15s target.** Spark's page read is
  ~22s of it and needs `reasoning_effort: "high"` to be correct at all.
- **Wire-trace coverage varies between runs on the same sketch**, because Spark's
  boxes are not reproducible. The reconciliation step means the netlist comes out
  right either way, but the proportion of connections that are *measured* rather
  than *inferred* is not stable, and the confidence figure moves with it.
- **One bundled sketch has a wire SAM will not segment under any phrasing tried**
  — a long thin horizontal stroke near the top of a ruled page. Its two verticals
  are found, the connection between them is inferred, and the app says so.
