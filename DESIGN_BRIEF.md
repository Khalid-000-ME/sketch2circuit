# Paste this into the Claude Design chat

**Canvas:** https://claude.ai/artifact/bebfe8a9-d92c-45f9-aee7-c042769d79c3
(13 slides, already built. Edit that canvas — do not create a new one.)

**What I need:** add the demo video to the deck, and attach the narration below to
each slide as speaker notes. I'm uploading 3 screen recordings in this chat.

---

## 1 · The video

I'm pasting 3 screen recordings (`.mp4`). They show the app running: photographing
a sketch, the analysis, and editing the result.

Please:
- Upload them as assets on the canvas.
- Put the demo clip on **slide 6 ("06 Live demo")**, replacing the four numbered
  step cards with the video playing full-bleed, keeping the headline
  "Watch it catch a burnt LED." and the dark `#14171C` background.
- If the clips need joining or trimming, cut to the moments that matter:
  (a) the phone photo being taken, (b) the finding appearing — "D1 has no
  current-limiting resistor… add a 470Ω resistor", (c) dragging a resistor in and
  the error clearing. Target 30–45 seconds total.
- If a video can't be embedded in an artboard, put a large still frame from the
  clip on slide 6 instead, with a play-button overlay, and tell me — don't fake it
  with a mock-up.

## 2 · The narration

Add each block below as speaker notes on its slide (or as a sticky note directly
under that slide's frame if speaker notes aren't supported — tell me which you did).

**Do not rewrite these.** They're written to be said out loud, not read. Keep the
contractions and the short sentences. Don't add adjectives, don't make them
"polished", and don't add anything the app doesn't do.

---

**Slide 1 · Title**
This is Sketch to Circuit. You draw a circuit on paper — the way you actually think about it — take a photo, and it tells you whether it works. That's the whole idea.

**Slide 2 · The problem**
Here's what every student does. You sketch a circuit in your notebook. Then you want to know if it's right. And to find out, you have to build the whole thing again — either in a simulator, clicking parts into place one at a time, or on a breadboard with real components. If it's wrong, what you get back is a dead LED. Or a wire that's too hot to touch. Nobody tells you why.

**Slide 3 · Why student prototyping is stuck**
The slow part isn't the thinking. It's the typing. Paper is where you work things out. But every simulator starts you at a blank canvas, and redrawing a sketch takes longer than drawing it did. So people skip that step and go straight to hardware. Hardware mistakes cost parts, and they cost time. And in a class of sixty, there's one teacher to explain them.

**Slide 4 · Why current tools fall short**
The tools that already exist assume you know how to use them. You can't start from a photo of your notebook. When something's wrong, they show you a voltage — not a reason. Microcontrollers need a different tool again. And if the part you want isn't in the library, you're stuck.

**Slide 5 · Our idea**
So: photograph the sketch, and we do the rest. Muse Spark reads the page — the symbols, the handwriting, the values. SAM 3.1 segments the parts and the wires. We turn that into a real connected circuit, solve it, and then say what we found in plain language. Four steps. One screen.

**Slide 6 · Live demo**
Let me show you. This is an LED wired straight across a 9 volt battery. It's the classic first mistake. I'll scan the code with my phone, take the picture… and there it is. It's found the battery, found the LED, and followed the wires between them. And look at what it says. Not "zero volts". It says: this LED has no current-limiting resistor; at 9 volts it'll draw roughly 438 milliamps, about 22 times its rating, and it'll fail within seconds. Add a 470 ohm resistor. So let's do that. Drag a resistor in, wire it up, and the error clears. That's the loop. Draw it, photograph it, fix it — before anything gets connected.

**Slide 7 · What makes it different, one**
Two things make this different from a drawing tool. The first is that it starts from the paper. Scan the code and the photo goes straight from your phone into the analysis. And it reads what you wrote, not just what you drew. If you listed your connections as a pin table down the side of the page — D13 to the LED, LED to 220 ohms, 220 ohms to ground — it reads that too, and checks it against the drawing. Where the two disagree, it tells you. It doesn't quietly pick one.

**Slide 8 · What makes it different, two**
The second is that it's doing real physics. There's a proper nonlinear DC solver underneath — Newton-Raphson, real diode models, the same approach SPICE uses. We checked it against calculations we did by hand, and it agrees to within a tenth of a percent. It knows Arduino and Raspberry Pi pin limits, so it catches the GPIO pin you're about to damage — which is the one mistake that costs you the whole board. And the result is yours to edit. Drag parts, draw wires between pins, delete things — in the schematic or on the 3D board — and all of it re-solves as you go.

**Slide 9 · Any part you can describe**
And if the part you need isn't in there, describe it. Type "a 5 volt relay with one normally open contact", and it builds it: the symbol, the 3D body, the named pins, and the electrical behaviour. But here's the part I actually care about. It doesn't just claim the behaviour. Every part comes with its own bench tests, and our solver runs them for real. If a test fails, the measured numbers go back and it tries again. You see exactly what it measured, what it assumed, and what it doesn't model. Ask it for a flux capacitor and it tells you no, and why.

**Slide 10 · Does it work**
Here's what we've measured. It identified every component in our test sketches. Three out of three netlists exactly right. The solver is within a tenth of a percent of hand calculation. Twenty-three device models checked against numbers we worked out on paper. And nothing intersects anything else in the 3D view, across eighteen circuits. Now — I want to be straight about the size of that. It's a small test set, we drew it ourselves, and we haven't tested it on real phone photos in bad lighting yet. That's the next thing we do, not something we're claiming today.

**Slide 11 · What's next**
The next thing is time. Right now we solve the steady state. A capacitor is an open circuit, and we don't run your firmware. We want charging curves, oscillators, a 555 actually oscillating, real code running on the board. More boards after that. And real photographs, from a real classroom.

**Slide 12 · Impact**
Why this matters. The loop from sketch to answer goes from retyping the whole circuit to taking one photo. Every student gets the explanation they'd otherwise be queuing for. Fewer components get burnt out, which is less electronic waste at the end of term. And a phone and a pencil stand in for a lab kit and a paid licence. That's quality education, and reduced inequalities — and the waste one is real, not decoration.

**Slide 13 · Close**
Paper is where circuits start. Now it can be where they get checked. If you've got a classroom, we'd like to test this against real student sketches. That's the ask.

---

## 3 · Rules — don't break these

**Type (already set, keep it):**
Instrument Serif for display headlines · Inter for body and explanations ·
JetBrains Mono for values, pin names, measurements and the small eyebrow labels.

**Colour (already set, keep it):**
Ink `#14171C` on `#F7F8FA` · accent `#0A62C9` · warning `#C2410C` ·
slide 6 inverts to `#14171C`.

**Never claim these — they are not built:**
time-based or AC simulation · firmware execution · datasheet-exact custom parts ·
boards beyond Arduino Uno and Raspberry Pi · accuracy on real phone photos ·
sharing. Slide 11 is the roadmap slide; that's where they belong.

**What IS built and can be claimed:** photo → circuit; phone capture by QR;
reading pin tables written on the page; nonlinear DC solver plus a rule engine;
Arduino Uno and Raspberry Pi pin limits; describe-a-part checked on the real
solver (9 starter parts); editing in both the schematic and the 3D board.

**Measured numbers (5 Nov 2026) — use these exactly, don't round them up:**
component identification 100% on our test sketches · 3/3 exact netlists · solver
within 0.1% of hand calculation · 23 hand-computed device cases pass · 0 parts
inside parts and 0 wires through parts across 18 circuits · 0 overlap or crossing
conflicts across 19 saved schematics. Small test set, drawn by us. Not a
benchmark. Not yet tested on real phone photos.

Every screenshot already on these slides is a real capture of the running app.
Keep it that way — no mock-ups.

**Repo:** github.com/Khalid-000-ME/meta
