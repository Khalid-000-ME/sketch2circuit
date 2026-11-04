# Sketch → Circuit: pitch deck brief

Use this file as the source for building the deck in Claude Design. Each section is one slide (or two where marked). Headline, body, and a visual suggestion are given for each. Copy is deliberately short. Numbers marked **[measured]** come from our own test runs; numbers marked **[verify]** are general claims you should source before presenting.

**Audience:** judges and educators. **Length:** 13 slides (12 plus the describe-a-part slide), about 5 minutes plus a live demo.
**Tone:** plain and concrete. No hype words. Show the product early.

---

## Slide 1: Title

**Headline:** Sketch → Circuit
**Subline:** Draw a circuit on paper. See if it works before you build it.
**Visual:** a hand-drawn LED circuit photo on the left, the rendered schematic and 3D board on the right, one arrow between them.

---

## Slide 2: The problem, in one scene

**Headline:** A student draws a circuit. Then they guess.
**Body:**
- The circuit starts on paper or a whiteboard.
- To learn whether it works, they must rebuild it by hand: in a simulator, or on a breadboard.
- If it is wrong, the feedback is a dead LED, a hot wire, or a burnt board pin. Nobody tells them why.

**Visual:** a notebook sketch, then a gap, then a scorched LED. Label the gap "retyping + guessing".

---

## Slide 3: Why student prototyping is stuck

**Headline:** The slowest step is not thinking. It is transcribing.
**Body:**
- Paper is where students think, but every simulator starts from a blank canvas.
- Redrawing a sketch in software takes longer than drawing it, so many students skip simulation and go straight to hardware. **[verify with a student survey]**
- Hardware mistakes cost parts and time, and a lab kit is not always available.
- Errors teach nothing unless someone explains them. In a class of 60 there is one teacher.

**Visual:** a flow with three steps, "Sketch → Retype in tool → Build", with the middle step highlighted red as the bottleneck.

---

## Slide 4: Why current simulation tools fall short

**Headline:** Existing simulators assume you already know how to use them.
**Body (a short table, no brand names needed):**

| Gap | What happens today |
|---|---|
| Input | Mouse-only. You cannot start from a photo of your notebook. |
| Feedback | A voltage readout, not a reason. "0.0 V" does not say "your LED has no resistor". |
| Learning curve | Menus, part libraries, and net labels come before the first result. |
| Boards | Microcontroller circuits need separate tools and firmware to simulate. |
| Rare parts | If a part is not in the library, you are stuck. |
| Access | Full-featured tools are heavy installs or paid. **[verify per tool]** |

**Visual:** the table, with a red cross in the cells and a green tick column on the right for Sketch → Circuit.

---

## Slide 5: Our idea

**Headline:** Photograph the sketch. We do the rest.
**Body:** Four steps, one screen.
1. **See.** Meta Muse Spark reads the page. SAM 3.1 finds the parts and wires.
2. **Build.** The drawing becomes a connected circuit, not a picture.
3. **Solve.** A real DC solver computes every voltage and current.
4. **Explain.** Plain-language findings: what is wrong, why, and what to change.

**Visual:** a four-step horizontal pipeline with an icon per step.

---

## Slide 6: Live demo (hold this slide for the product)

**Headline:** Watch it catch a burnt LED.
**Demo script (60 seconds):**
1. Scan the QR code with a phone and photograph a sketch of an LED wired straight to a battery.
2. The schematic appears. Finding: "LED current is far above its limit. Add a series resistor of about 330 Ω."
3. Drag a resistor into the loop. The finding clears. Current drops into a safe range.
4. Switch to the 3D board and orbit it.

**Backup:** the bundled samples work offline if the network is slow. The app labels them "Cached result" so nothing is passed off as live.

---

## Slide 7: What makes it different (1 of 2)

**Headline:** It starts from the paper, and it tells you why.
**Features:**
- **Photo in, circuit out.** Handwritten schematics become an editable circuit.
- **Phone capture by QR.** Open the app on a laptop, scan the code, photograph the sketch on your phone. The photo goes straight to the analysis.
- **Reads what is written, not only what is drawn.** Pin tables such as "D13 → LED → 220 Ω → GND" are read and checked against the drawing. Contradictions are flagged, not guessed.
- **Findings in plain language.** Each finding names the part, the number, and the fix.

**Visual:** a sketch with a pin table beside it, with the checklist panel showing each line as satisfied, open, or in conflict.

---

## Slide 8: What makes it different (2 of 2)

**Headline:** Not just resistors and LEDs.
**Features:**
- **Real physics.** A nonlinear DC solver (Newton-Raphson with diode limiting). Hand-checked against calculations to within 0.1%. **[measured]**
- **Boards and pins.** Arduino Uno and Raspberry Pi, with pin limits. We warn when a GPIO pin is asked for more current than it can supply, which is the classic way to damage a Pi. **[measured against the datasheet limits we encode]**
- **Rule engine.** LED without a resistor, shorted supply, floating input, GPIO overcurrent, 5 V on a 3.3 V pin, missing ground, and more.
- **Editable result, in both views.** Drag parts, draw wires by clicking pins, remove a wire, rotate, delete, add parts: in the flat schematic and on the 3D board. Every edit re-solves instantly, so the findings change as the circuit does.
- **Two views.** A clean flat schematic by default, and a 3D board with animated current flow. Wires route over parts and never run through them, and no part sits inside another. This is measured by a geometry test, not just looked at.

**Visual:** an Arduino sketch with a warning on pin D13, next to a Pi sketch with a red "GPIO 3.3 V, 16 mA max" finding.

---

## Slide 8b: Any part you can describe (the headline feature)

**Headline:** Not in the library? Describe it.
**Body:**
- Type "a 5V relay with one normally open contact rated 10A". The app builds the part: symbol, 3D body, named pins, readings and limits.
- **The behaviour is checked, not claimed.** A part is a small network of the same device models the simulator already runs (resistors, diodes, zeners, switches, relays, transistors, MOSFETs, op-amps). The part ships with its own bench tests, and the real solver runs them. A failed test goes back to the model with the measured numbers to fix.
- **It tells you what it does not know.** Each part shows what it assumes and what it does not model, and is labelled "DC only" or "approximate" when it is. A made-up thing ("a flux capacitor") is refused with a reason.
- Eight ready-made parts ship (relay, zener, NPN, PNP, logic-level MOSFET, op-amp, Schottky diode, light sensor, thermistor). Parts you describe are kept for next time.

**Proof points (say these, they are true):**
- A relay in a circuit pulls in at the right coil voltage and lights an LED; starve the coil and it stays open. The numbers match a hand calculation to within about 0.2%.
- Live, a 9.1V zener failed its own check on the first try and passed after one correction round.

**Visual:** the dialog: description box, then the "What the solver measured" list with ticks, then "It assumes / It does not model", then the part dropped into a circuit.

---

## Slide 9: Does it work? (honest numbers)

**Headline:** What we measured.
**Body:**
- Component identification: **100%** on our test sketches. **[measured]**
- Exact netlist (every connection correct): **3 of 3** original sketches, plus both board sketches and a table-only page. **[measured]**
- Schematic readability: 15 saved cases, **zero** overlap or crossing conflicts. **[measured]**
- Solver: matches hand calculation within **0.1%**. **[measured]**
- Device models (relay, zener, transistors, MOSFET, op-amp, diode, current source): **23 hand-computed cases** pass, plus 8 starter parts and 4 whole circuits. **[measured]**
- 3D scene: **0** parts inside parts, wires inside parts, or wires touching, across 14 circuits including a busy board. **[measured]**

**Said out loud, not on the slide:** the test set is small and was drawn by us. A described part's checks are written by the same model that wrote the part, so the app shows them to you rather than asking for trust; the solver proves the circuit behaves as the checks say, not that it matches a datasheet. Real phone photos in varied lighting are the next test. The Model API's response time varies between about 12 and 95 seconds on the same image, so we built a timeout and a cached fallback that is always labelled.

**Visual:** four large numbers. A small footnote: "Small test set. Not a benchmark."

---

## Slide 10: Roadmap (this is what we are building next)

**Headline:** From operating points to behaviour over time.
**Body:** *Not yet shipped.*
- **Time-based simulation.** Capacitor charging, oscillators, a 555 timer, and microcontroller programs. Today we solve DC only, so timing parts are modelled at their steady state and labelled as such.
- **More boards and modules.** ESP32, Raspberry Pi Pico, common sensor modules.
- **Tested on real photographs.** Our samples are generated; the next step is a set of real phone photos in varied light, and a classroom pilot.
- **Sharing.** Send a circuit, with its custom parts, to a teacher as a link.

**Visual:** a timeline with "Now" and "Next". "Now" lists what is built; "Next" lists the above.

---

## Slide 11: Impact and the SDGs

**Headline:** Faster learning, fewer burnt parts, wider access.

**Impact:**
- **Shorter loop.** The step from sketch to verified result drops from retyping to one photo.
- **A teacher for every desk.** Plain-language findings give each student the explanation they would otherwise wait for.
- **Fewer broken parts.** Mistakes are caught on screen, before a pin or LED is damaged.
- **Works without a lab.** Anyone with a phone and a pencil can test a circuit idea.

**UN Sustainable Development Goals:**

| SDG | How the project contributes |
|---|---|
| **SDG 4: Quality Education** | Immediate, explained feedback on hand-drawn work. Students learn why a circuit fails, not only that it failed. |
| **SDG 9: Industry, Innovation and Infrastructure** | Lowers the barrier to electronics prototyping and gives makers a fast first check before hardware. |
| **SDG 10: Reduced Inequalities** | A phone replaces a lab kit and a licensed simulator for students without access to either. |
| **SDG 12: Responsible Consumption and Production** | Fewer burnt components and wasted boards means less electronic waste. |

**Visual:** the four SDG icons in a row, with one line each. Use the official SDG colours and numbers.

---

## Slide 12: Close and ask

**Headline:** Paper is where circuits begin. Now it can be where they get checked.
**Body:**
- One line recap: photo → circuit → physics → plain-language answer.
- The ask: pilot access in one or two classrooms, and real student sketches to test against. *(Replace with your actual ask.)*
- Contact and repository link.

**Visual:** the opening sketch photo again, now with a green "Circuit OK" chip.

---

## Notes for the deck builder

- **Style:** light background, one accent colour, large type, one idea per slide. Use real screenshots from the app instead of mock-ups. The app already produces clean schematics and the 3D board.
- **Screenshots to capture:** (1) a sketch photo, (2) the schematic with a finding, (3) the pin-table checklist, (4) the Arduino warning, (5) the 3D board, (6) the QR pairing screen.
- **Claims to verify before presenting:** anything tagged **[verify]**, and the exact current Pi and Arduino pin limits we encode, so they are cited from the datasheets.
- **Do not claim:** firmware simulation, time-based behaviour, datasheet-exact models of described parts, or accuracy on real phone photos (not yet tested). Say instead that described parts are checked on the real solver against their own tests.
