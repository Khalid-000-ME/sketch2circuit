# Submission answers — copy each block into the form

Repo: `https://github.com/Khalid-000-ME/sketch2circuit`

---

## Project Description (limit 3,000)

Sketch → Circuit turns a photo of a hand-drawn circuit into a circuit that is actually simulated, and tells you what is wrong with it in plain language.

The problem is a gap every electronics student falls into. You work a circuit out on paper, because paper is where you think. To find out whether it works, you have to build it a second time — clicking parts into a simulator, or wiring a breadboard. Redrawing takes longer than drawing did, so most people skip simulation and go straight to hardware. When it is wrong, the feedback is a dead LED or a hot wire, and nobody explains why. In a class of sixty there is one teacher.

You photograph the page instead. Muse Spark reads the symbols, the handwriting and the values. SAM 3.1 segments the parts and the wires. We recover connectivity by walking the ink on the page rather than guessing, canonicalise it into a netlist, and solve it with a nonlinear DC operating-point solver (modified nodal analysis with Newton-Raphson and real diode models). A rule engine then says, for example: "D1 has no current-limiting resistor. At 9V it will draw roughly 438mA, about 22x its 20mA rating. Add a 470Ω resistor."

What it does beyond reading the drawing:

- Reads connections you wrote as a pin table, checks them against what you drew, and flags contradictions instead of silently choosing one.
- Knows Arduino Uno and Raspberry Pi pin limits, so it catches the GPIO pin you are about to damage.
- Lets you describe a part in words — "a 5V relay with one normally open contact" — and builds it from the solver's own device primitives. Every generated part ships with bench tests that our solver runs for real; a failing test is sent back with the measured numbers to be corrected.
- Is editable: drag parts, wire pins, delete, rotate — in the schematic or on the 3D board — and everything re-solves.
- Pairs with your phone by QR so you can photograph the page with the better camera.

Measured, honestly: 100% component identification on our test sketches; 3/3 exact netlists; the solver agrees with hand calculation to within 0.1%; 23 hand-computed device-model cases pass; zero geometric intersections across 18 circuits in 3D; zero overlap or crossing conflicts across 19 saved schematics. That is a small test set that we drew ourselves. It is not a benchmark, and we have not yet tested it on real phone photographs in poor lighting.

It solves DC only. Capacitors are open circuits, inductors are shorts, and firmware is not executed — the app says so rather than quietly reporting zero.

---

## Describe your use of Meta products (limit 3,000)

Two models, each doing something the other cannot, through the Meta Model API.

**Muse Spark (`muse-spark-1.3`)** via `/chat/completions` with JSON-schema structured output. Three jobs:

1. Reading the page: every component, its type, its handwritten value and unit, a first guess at connectivity, bounding boxes in permille, and noun phrases to hand to SAM. Run at `reasoning_effort: "high"`.
2. Re-reading individual component crops when a value is uncertain, at `reasoning_effort: "minimal"`.
3. Designing parts people describe in words. Spark returns a part definition — pins, a network of device primitives, ratings — *plus bench checks with expected voltages and currents*. We run those checks through our own solver and send failures back with the measured numbers, up to three rounds.

**SAM 3.1 (`sam-3.1`)** via `/responses` as a stream, parsed with `@meta-sam/parser`. Noun-phrase prompts for wires, and box prompts built from Spark's bounding boxes for components.

Things we learned by measuring, not guessing:

- `reasoning_effort: "high"` is required for the page read. At `medium` the same sketches came back with duplicated components, no values at all, and unusable connectivity — and not faster, because a confused read reasons for longer.
- SAM could not find a battery from the noun phrase "battery" on a hand-drawn page. Box prompts derived from Spark's bounding boxes fixed it completely.
- SAM's wire masks missed hand-drawn wires often enough that we stopped relying on them. We build an ink layer from the image (adaptive threshold, ruled-line removal), union it with SAM's masks, punch out component bounding boxes, and walk the remaining regions. That made connectivity deterministic.
- `temperature: 0` reduces variance but does not make Spark deterministic, because the sampling that matters happens in the reasoning trace. SAM, by contrast, is deterministic.
- Latency has a long tail: three identical requests measured at 12.8s, 95.6s and a TLS read timeout. We bound every stage with idle and total limits, retry dropped sockets once, and cap the whole analysis.

A healthy end-to-end analysis lands in 16–47 seconds, verified live across all six bundled samples.

---

## Why are Meta's models important to your solution? (limit 3,000)

The product is only possible because these two models do different things well, and the Model API puts both behind one key.

A hand-drawn circuit on ruled notebook paper is a hard input. The symbols are inconsistent, the handwriting is small and sits at angles, values are abbreviated ("4k7", "220Ω", "red LED"), and the wires are wobbly pencil lines that cross and double back. Reading that needs a model that can reason over an image and return structure, not prose. Muse Spark's combination of multimodal reasoning, a long context, and strict JSON-schema output is what makes the page read usable at all — we get back a typed object we can validate, not text to parse hopefully. The `reasoning_effort` control mattered more than we expected: it is the difference between a correct read and an unusable one, and we could measure that.

SAM 3.1 contributes something a reasoning model cannot: pixel-accurate, promptable, deterministic masks. We need to know *where* each component sits so we can subtract it from the ink and trace the wires between the gaps. Being able to prompt it with boxes rather than nouns is what made it work on hand-drawn symbols that look nothing like photographs of real components.

Neither alone is enough. Spark knows what things are but its coordinates drift by a few percent run to run. SAM knows exactly where things are but not what they mean. Spark proposes, SAM localises, and our own deterministic code decides — which is the architecture we would defend regardless of vendor.

The part that surprised us is the describe-a-part feature. We did not want a model asserting electrical behaviour, because a plausible-sounding wrong model is worse than no model. Because Spark returns reliable structured output, we could ask it for two things at once: a part built from our solver's primitives, *and* the bench tests that would prove it behaves as described. Our solver then checks the model's claim against the model's own prediction, and the repair loop sends real measured numbers back. A 9.1V zener failed its first attempt and passed after one correction. An HC-SR04 came back modelled honestly as a DC load and labelled "DC only". A flux capacitor was refused, with a reason. The verification is ours; the structured generation that makes verification possible is Spark's.

---

## Partner technology feedback (limit 150)

We did not use Fireworks, Modal or Baseten. Everything runs against the Meta Model API directly from a self-hosted Next.js server.

---

## Questions only you can answer

These are opinion scales — answer them yourself, honestly. Notes from what we actually hit, in case they help:

**Biggest obstacle:** recovering connectivity. Segmentation masks for hand-drawn wires were unreliable, so we built a deterministic ink-tracing pass instead of trusting the model. Second: latency variance on identical inputs (12.8s to 95.6s), which forced real timeout and retry design.

**Compared with other models:** the page read needed high reasoning effort to be correct at all; at medium it produced duplicated components and no values. Structured JSON output held up well. Worth saying plainly.

**What matters most when choosing:** structured output you can validate, and a reasoning control you can tune per call.

**Hardest thing about switching:** prompts tuned per effort level, and a pipeline shaped around one model's bounding-box behaviour.

**What would stop production use:** latency variance on identical inputs, and no determinism even at `temperature: 0`.

**Demo video:** still to be produced from the recordings in `public/demo/`.
