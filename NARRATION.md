# Sketch → Circuit — spoken narration

Thirteen blocks, one per slide, in deck order. Written to be **said, not read**:
short sentences, contractions, no adjectives doing work that a number should do.

**Total: about five minutes** at an unhurried pace, plus however long the live
demo on slide 6 actually takes. Don't rush slide 6 — the pause while it thinks is
the proof that it's really running.

**Delivery notes**

- Numbers are written as digits. Say them the long way: "four hundred and
  thirty-eight milliamps", not "four three eight".
- The slashes mark a breath, not a full stop.
- Slide 10 has the honest caveat in it. Say it. It lands better than it reads,
  and judges have heard a hundred decks that didn't.
- Nothing here claims anything the app can't do. If you cut a line, cut a whole
  line rather than trimming the qualifier off the end of one.

---

### 1 · Title

This is Sketch to Circuit.

You draw a circuit on paper — the way you actually think about it — take a photo,
and it tells you whether it works. That's the whole idea.

---

### 2 · The problem

Here's what every student does.

You sketch a circuit in your notebook. Then you want to know if it's right. And
to find out, you have to build the whole thing again — either in a simulator,
clicking parts into place one at a time, or on a breadboard with real components.

If it's wrong, what you get back is a dead LED. Or a wire that's too hot to
touch. / Nobody tells you why.

---

### 3 · Why student prototyping is stuck

The slow part isn't the thinking. It's the typing.

Paper is where you work things out. But every simulator starts you at a blank
canvas, and redrawing a sketch takes longer than drawing it did. So people skip
that step and go straight to hardware.

Hardware mistakes cost parts, and they cost time. And in a class of sixty,
there's one teacher to explain them.

---

### 4 · Why current tools fall short

The tools that already exist assume you know how to use them.

You can't start from a photo of your notebook. When something's wrong, they show
you a voltage — not a reason. Microcontrollers need a different tool again. And
if the part you want isn't in the library, you're stuck.

---

### 5 · Our idea

So: photograph the sketch, and we do the rest.

Muse Spark reads the page — the symbols, the handwriting, the values. SAM 3.1
segments the parts and the wires. We turn that into a real connected circuit,
solve it, and then say what we found in plain language.

Four steps. One screen.

---

### 6 · Live demo

Let me show you.

This is an LED wired straight across a 9 volt battery. It's the classic first
mistake. I'll scan the code with my phone, take the picture…

*(let it run — don't talk over the wait)*

…and there it is. It's found the battery, found the LED, and followed the wires
between them.

And look at what it says. Not "zero volts". It says: this LED has no
current-limiting resistor; at 9 volts it'll draw roughly 438 milliamps, about 22
times its rating, and it'll fail within seconds. Add a 470 ohm resistor.

So let's do that. Drag a resistor in / wire it up / and the error clears.

That's the loop. Draw it, photograph it, fix it — before anything gets
connected.

---

### 7 · What makes it different, one

Two things make this different from a drawing tool.

The first is that it starts from the paper. Scan the code and the photo goes
straight from your phone into the analysis.

And it reads what you *wrote*, not just what you drew. If you listed your
connections as a pin table down the side of the page — D13 to the LED, LED to
220 ohms, 220 ohms to ground — it reads that too, and checks it against the
drawing. Where the two disagree, it tells you. It doesn't quietly pick one.

---

### 8 · What makes it different, two

The second is that it's doing real physics.

There's a proper nonlinear DC solver underneath — Newton-Raphson, real diode
models, the same approach SPICE uses. We checked it against calculations we did
by hand, and it agrees to within a tenth of a percent.

It knows Arduino and Raspberry Pi pin limits, so it catches the GPIO pin you're
about to damage — which is the one mistake that costs you the whole board.

And the result is yours to edit. Drag parts, draw wires between pins, delete
things — in the schematic or on the 3D board — and all of it re-solves as you go.

---

### 9 · Any part you can describe

And if the part you need isn't in there, describe it.

Type "a 5 volt relay with one normally open contact", and it builds it: the
symbol, the 3D body, the named pins, and the electrical behaviour.

But here's the part I actually care about. It doesn't just *claim* the behaviour.
Every part comes with its own bench tests, and our solver runs them for real. If
a test fails, the measured numbers go back and it tries again. You see exactly
what it measured, what it assumed, and what it doesn't model.

Ask it for a flux capacitor and it tells you no, and why.

---

### 10 · Does it work

Here's what we've measured.

It identified every component in our test sketches. Three out of three netlists
exactly right. The solver is within a tenth of a percent of hand calculation.
Twenty-three device models checked against numbers we worked out on paper. And
nothing intersects anything else in the 3D view, across eighteen circuits.

Now — I want to be straight about the size of that. It's a small test set, we
drew it ourselves, and we haven't tested it on real phone photos in bad lighting
yet. That's the next thing we do, not something we're claiming today.

---

### 11 · What's next

The next thing is time.

Right now we solve the steady state. A capacitor is an open circuit, and we
don't run your firmware. We want charging curves, oscillators, a 555 actually
oscillating, real code running on the board.

More boards after that. And real photographs, from a real classroom.

---

### 12 · Impact

Why this matters.

The loop from sketch to answer goes from retyping the whole circuit to taking one
photo. Every student gets the explanation they'd otherwise be queuing for. Fewer
components get burnt out, which is less electronic waste at the end of term. And
a phone and a pencil stand in for a lab kit and a paid licence.

That's quality education, and reduced inequalities — and the waste one is real,
not decoration.

---

### 13 · Close

Paper is where circuits start. Now it can be where they get checked.

If you've got a classroom, we'd like to test this against real student sketches.
That's the ask.

---

## If you need a 60-second cut

Blocks 1, 6, 9, and 13 — the idea, the live catch, the part you describe, and the
ask. Everything else is supporting material.
