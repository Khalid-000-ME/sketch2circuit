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

### A note on the two views

The 3D board came first and is accurate to a fault: a 9V PP3 really is 48mm long
and a 5mm LED really is 5mm, so a true-to-life board makes the battery dwarf
everything that matters. Accurate and unhelpful. The schematic became the default
for that reason; the board stays one click away, because watching a circuit
assemble itself is a better twenty seconds of video than watching a diagram
appear.

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

## The views

There are two, and the **schematic is the default**.

### Schematic (default)

Plain SVG. Standard symbols — zigzag resistor, triangle-and-bar LED,
long-and-short battery plates, a curved negative plate on an electrolytic — on a
grid, with orthogonal wires, junction dots where three or more leads meet, and a
reference designator and value beside every part. It is the representation a
beginner meets in every textbook and every other simulator, which is the point:
nothing about the drawing needs explaining.

SVG rather than canvas because a schematic is a few hundred lines and labels,
every one of which wants to be a hit target, a focus target and a CSS state.
In the DOM, hover, selection, keyboard traversal and the fault pulse come almost
free, and it stays crisp at any zoom.

Three details worth knowing, each of which fixed a visible defect:

- **Labels are offset by the body, not the pin span.** Offsetting by the pin span
  pushes a label past the part's own leads and onto whatever wire runs there. A
  vertical part puts both labels to its right, because above and below is exactly
  where its leads are.
- **A part is scored against its own 180° flip.** The bearing between neighbour
  centroids picks the right axis but not always the right end — on a node joining
  five leads the centroid says nothing about which side of *this* part it is on.
  A part turned the wrong way sends each lead away from the node it joins, and
  the router doubles back, leaving a spur past the component.
- **A part is then pulled between the two nodes it joins**, into a space that is
  actually free. The relaxation only knows that connected things attract, so it
  will leave a decoupling capacitor above both of the rails it bridges, where
  every wire leaving it runs back through its own body.

Inferred connections — the ones the mask walk could not confirm — are drawn
dashed, so provisional topology looks provisional.

### 3D board

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

**Nothing is inside anything else.** Wires used to arc at a fixed height and ignore
what was under them, so on the Pi and the motor driver they ran through the board
and a body. Now ([`plan.ts`](src/three/plan.ts)) each wire rises from its pin,
clears the tallest part under its path, and takes a free height or a sideways lane
against wires of other nets; a wire that finds no route is placed first on the next
attempt. Parts are separated by the rectangle each really occupies, including
geometry built off-centre, in whole grid steps. [`check-3d.ts`](scripts/check-3d.ts)
measures it headlessly on every fixture plus a busy board, for part-on-part,
wire-in-part and wire-touching-wire, and it was shown to fail when avoidance is
switched off (wires inside the Pi, inside the motor).

---

## Boards: Arduino and Raspberry Pi

A board is not a part with two leads. It is supply pins and general-purpose pins,
and the mistakes worth catching are all about their limits. Both boards are
modelled from the manufacturers' published figures, kept in one table
([`boards.ts`](src/lib/circuit/boards.ts)) that the solver, the rules, the symbols
and the 3D models all read.

| | Arduino Uno | Raspberry Pi |
|---|---|---|
| Logic level | 5V | 3.3V |
| Per-pin current | warn above 20mA, damage above 40mA | warn above 8mA, damage above 16mA |
| Pin tolerance | up to 5.5V | **3.6V; not 5V tolerant** |
| Supply pins | 5V (0.5A), 3V3 (0.15A) | 3V3 (0.05A), 5V (1A) |

A driven pin or supply pin is a voltage behind a resistance, stamped as a Norton
equivalent, so it adds no unknowns to the matrix. **What a pin is doing is set by
firmware, which a sketch cannot show**, so a wired pin is assumed to be driven
HIGH, the case that is hardest on whatever is on it. That assumption is stated as
a finding, shown as "assumed" in the inspector, and editable per pin.

New checks: pin overcurrent, voltage above what a pin tolerates (5V into a Pi
GPIO), a supply pin asked for more than it can give, and a missing GND. The solver
was checked against currents worked out by hand from the same LED model and agrees
to under 0.1 percent ([`engine-assert.ts`](scripts/engine-assert.ts)).

Pins are **strict**: an unrecognised pin name is dropped and reported, never
remapped. Every other part falls back to its first pin when a name is unclear,
which is harmless on a resistor and wrong on a board, where silently wiring `D99`
to `RESET` is worse than saying it does not exist.

In the schematic a board is a labelled block, and ground and supply rails are drawn
as **symbols at each pin instead of wires**, as every schematic tool does: a ground
drawn as a wire must be routed round the whole symbol, and reads as touching every
pin it passes.

Both boards are also built in 3D (the Pi on its real physical pin map).

## Editing

The schematic is an editor. Drag a part to move it; click a pin and then another
to wire them (a connected pin offers Disconnect); **R** turns a part, **Delete**
removes it, **Esc** cancels. **Add part** places any part or board. Every edit is
re-solved, so the findings change as the circuit does, and a board's inspector
shows each wired pin with its current and a High / Low / Input control.

Parts stay where they are put: the layout is only ever asked to place parts it has
not placed before, so wiring something never undoes a drag.

**The 3D board edits the same way.** Drag a part along the board (it snaps to the
grid and will not be dropped onto another part); click a pin, then another, to wire
them; click a wire to remove it; **R** turns the selected part and **Delete**
removes it. Wires re-route as a part moves. Once anything is placed by hand every
part is held where it is, and a part added later lands on the nearest free spot
beside whatever it connects to. Driven with a real pointer in
[`edit3d-test.ts`](scripts/edit3d-test.ts).

Each of these was driven in a real browser
([`interact-test.ts`](scripts/interact-test.ts), 17 checks). Placement is measured
relative to parts that never move, since selecting a part brings it into view and
screen coordinates change when nothing has.

## Describe a part

**Add part → Describe a part…** takes a plain description ("a 5V relay with one
normally open contact rated 10A") and adds that part to the circuit, with a
symbol, a 3D body, named pins, readings and limits.

The behaviour is not a claim by the model. A part is a small network of the same
device primitives the solver already runs — resistor, diode, zener, voltage and
current source, switch, relay-style voltage-controlled switch, BJT (Ebers-Moll),
MOSFET (square law) and op-amp — between its pins and a few hidden nodes
([`partdef.ts`](src/lib/circuit/partdef.ts), [`devices.ts`](src/lib/circuit/devices.ts)).
A relay is a coil resistor plus a switch the coil closes; a 5.1V zener is a diode
with a breakdown. Because those are exactly what a drawn resistor or LED is
simulated with, the part behaves as described *to the extent the primitives can say
it*, and `limits` records what they cannot.

What the model returns is checked three ways before anyone can use it:

1. **Validation.** Unknown pins, values out of range and unsolvable shapes are
   rejected with the reason.
2. **The bench.** Each part carries 2–5 checks (drive these pins with these
   sources, expect this voltage or current). They are built into an ordinary circuit
   and run through the real solver ([`part-checks.ts`](src/lib/circuit/part-checks.ts)).
   A check that fails is sent back to the model with the measured numbers, up to
   three rounds; a timed-out round is retried. In live runs a 9.1V zener needed a
   second round and passed after it.
3. **You.** The dialog shows what the solver measured, what the part assumes, and
   what it does not model. A part that fails its checks can only be added
   deliberately ("Add anyway").

Parts are kept in this browser ("My parts"). Nine ship ready to use — relay, zener,
NPN, PNP, logic-level MOSFET, op-amp, Schottky diode, LDR, NTC thermistor
([`parts.ts`](src/fixtures/parts.ts)) — each held to its own checks by
[`part-assert.ts`](scripts/part-assert.ts), whose 23 primitive cases were worked out
by hand from the device equations.

**What this does not promise.** The checks come from the same model that wrote the
part, so a part can be consistent with its own checks and still differ from its
datasheet; that is why they are shown. The simulator is DC only, so a 555, a
microcontroller or anything defined by timing is modelled at its steady state and
labelled "DC only" or "approximate". Live, an HC-SR04 came back as a supply draw and
an echo pull-down, labelled DC only, and "a flux capacitor" was refused with a
reason. A part that is not an electronic component is refused rather than invented.

Ratings the description gives become findings like any other: a relay contact
past its 10A, or a transistor past its collector current, is flagged in the
same plain language.

## Written connections

A page can state how things connect in writing as well as in drawing: a wiring
table, a pin list, arrows between names (`D13 -> R1`, `R1 -> LED +`, `pin 11 ->
LED +`). The app reads those as a separate kind of evidence from drawn wires, and
it works on a page with **no drawing at all**.

A written line is an explicit statement, so it is handled by what it would do:

| The line | What happens |
|---|---|
| is already true of the drawing | **Confirmed.** Nothing changes. |
| adds a connection nothing contradicts | **Applied**, before the circuit is solved, so the findings describe the circuit the writing says. |
| would join two connections the drawing has already established | **Not applied, and reported.** Merging two nets by mistake is how a supply gets shorted, so the drawing is kept and **Use the table** applies the line on request. |
| names a pin that does not exist, a part that is not there, or an LED with no lead | **Refused, with the reason.** Never guessed. |

Lines are read in the order written, so `D13 -> R1` followed by `R1 -> LED +` uses
two different ends of R1, which has no wrong end. On a drawn circuit a bare `R1`
means the end that is already there. Pin numbers are read as people write them:
`pin 11` on a Pi is the physical position, so GPIO17.

In the interface, a **Written on your page** checklist shows each line and whether
it is in the circuit *right now*. Status is computed from the current nets, not
stored, so it notices a connection removed by hand and a click restores it.

Checked in three ways: [`spec-assert.ts`](scripts/spec-assert.ts) for the logic,
[`spec-ui-test.ts`](scripts/spec-ui-test.ts) in a browser, and two pages run live
through both models with no sample id. A page that is only a table came out exactly
right. A page with a correct drawing and a table line that contradicts it kept the
drawing, held the line back and said why.

## Phone capture

On the capture screen, **Use your phone** shows a QR code. Scan it, photograph the
circuit with the phone's own camera, and the photo arrives on the desktop and is
analysed exactly as an upload would be.

The phone page is a file input with `capture`, not a live viewfinder: that works
over plain HTTP on a local network, where `getUserMedia` is refused, and the OS
camera gives a full-resolution, focused shot.

- **Same network.** The link uses the machine's private LAN address, not
  `localhost` (which on a phone means the phone). Wi-Fi and Ethernet are preferred.
- **Firewall.** macOS may ask whether Node may accept incoming connections. Allow it.
- **A tunnel or a deployment:** set `PUBLIC_ORIGIN` (see `.env.example`).
- **Sessions are in process memory.** Right for one server and two devices; wrong
  for several instances, where the phone's upload and the desktop's poll can land on
  different ones. That case needs a shared store.
- The token is 128 bits from the system CSPRNG and the only thing that identifies
  anything; it expires after ten minutes, the store is capped, and the photo is
  deleted the moment it is collected.

[`pair-test.ts`](scripts/pair-test.ts) runs two browsers, one an emulated iPhone, over
the LAN address, and **decodes the QR from the rendered pixels** with an independent
reader. A code that draws is not a code that scans.

## What was reused, and what was not

Before building boards I looked at what already exists, checking licence and
contents directly against the repositories instead of trusting search snippets.

| Source | Licence | Used? |
|---|---|---|
| [wokwi/wokwi-elements](https://github.com/wokwi/wokwi-elements) | MIT | **No, but the best candidate.** Realistic 2D parts (Uno, Nano, Mega, ESP32, about fifty more) with real pin coordinates. It has no Raspberry Pi, and it is 2D, so it would be a third view, not a replacement. |
| [KiCad packages3D](https://github.com/KiCad/kicad-packages3D) | CC-BY-SA 4.0 | **No.** Redistributing converted models means keeping share-alike and attribution, and the archived snapshot contains no Arduino or Pi (only a Wemos D1 mini). |
| [tscircuit/3d-viewer](https://github.com/tscircuit/3d-viewer) | MIT | No. Generic chips and passives, heavy dependency tree. |
| [JENW1N/ohmlet](https://github.com/JENW1N/ohmlet) | MIT | No. A Three.js breadboard simulator built from procedural parts, which is the same approach as here. A reference, not copied: whether the hackathon allows starting from existing code is still an open question in the PRD. |
| A ready-made Arduino or Pi `.glb` | none found | Nothing clearly licensed turned up on GitHub. |

So the boards are procedural, which keeps the licensing clean and matches how every
other part here is built.

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
| `PUBLIC_ORIGIN` | the machine's LAN address | Where a phone should be sent, for a tunnel or deployment |
| `SAMPLE_DEADLINE_MS` | `45000` | How long a bundled sample may spend in live analysis before its cached result is shown |
| `ANALYZE_BUDGET_MS` | `150000` | Hard ceiling on any single analysis |

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
├── schematic/
│   ├── symbols.tsx               one SVG symbol per type, pins and body extents
│   ├── layout2d.ts               grid placement, axis snapping, orientation
│   └── route2d.ts                orthogonal wire routing
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
npx tsx scripts/part-assert.ts    # device primitives, starter parts, whole circuits, by hand
npx tsx scripts/check-3d.ts       # no part in a part, no wire in a part, no wires touching
npx tsx scripts/edit3d-test.ts    # drag, wire, remove, turn, delete in the 3D view
npx tsx scripts/describe-ui-test.ts  # the describe-a-part dialog (canned model reply)
npx tsx scripts/live-parts.ts "a 9.1V zener"  # describe parts to the live model
npx eslint src scripts
npx tsc --noEmit
```

---

## Honest limitations

- **3D wire routing is a search, not a guarantee.** Wires avoid parts and each
  other by choosing a height and a lane, tested on every fixture and a busy board;
  a board packed tighter than that can leave a wire with no clean option, in which
  case it takes its best attempt and may touch another. The camera is not re-framed
  when a part is added and the board grows.
- **Two boards.** Arduino Uno and Raspberry Pi. No Nano, Mega, ESP32, Pico or
  peripherals (LCDs, servos, sensors); `wokwi-elements` is the obvious route to those.
- **The solver runs DC only,** so a board's firmware is not simulated: a pin is
  High, Low or Input, not a program.
- **Board pin labels are read by the model,** since nothing on the page says where
  each pin is. The wire to a board is traced; which pin it reaches is not.
- **Wiring by keyboard is not supported.** Parts can be selected, turned and deleted
  from the keyboard; connecting two pins needs a pointer.
- **Phone pairing needs one server and one network** (see above).
- **A written line the model garbles is refused, not repaired.** On one live page
  `LED - -> GND` lost its minus to the arrow, so the lead was unknown and the line
  was dropped with a warning. Refused lines appear in the warnings, not in the
  checklist.
- **Written lines have no confidence of their own.** Pins a line accounts for are
  scored by how well the handwriting was read overall.
- **DC only.** No transient or AC analysis. Capacitors are open circuits and
  inductors are shorts, which is correct for an operating point and useless for
  anything time-varying.
- **A transistor or IC *drawn* on a sketch is shown but not simulated,** because a
  sketch does not say which kind it is. The app says so in a finding. A transistor
  *added* from the palette, or any part described, is simulated.
- **Potentiometer wipers are fixed at 50%.**
- **A described part is only as true as its description and its checks.** See
  *Describe a part*. Timing, firmware and radio behaviour are not modelled.
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
