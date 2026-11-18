const test = require("node:test");
const assert = require("node:assert");
const Fret = require("../js/fretboard.js");

const line = (...midis) => midis.map((midi, i) => ({ midi, start: i * 0.25 }));
const sounds = (spots, strings) => spots.map((s) => Fret.tuning(strings)[s.string] + s.fret);
const fretted = (spots) => spots.filter((s) => s.fret > 0).map((s) => s.fret);

test("every spot sounds the note it stands for", () => {
  const notes = line(28, 31, 33, 35, 36, 38, 40, 43, 45, 47, 48, 50, 52, 55, 57, 59, 60);
  for (const strings of [4, 5]) {
    assert.deepStrictEqual(sounds(Fret.finger(notes, strings), strings), notes.map((n) => n.midi));
  }
});

test("a low riff stays in first position, open strings included", () => {
  const spots = Fret.finger(line(28, 31, 33, 36, 38, 36, 33, 31), 4);
  assert.ok(Math.max(...spots.map((s) => s.fret)) <= 5, JSON.stringify(spots));
  assert.strictEqual(spots[0].fret, 0, "low E is the open E string");
});

test("a line higher up is played in one hand position, no jumping around", () => {
  const spots = Fret.finger(line(45, 47, 48, 50, 52, 50, 48, 47, 45, 47, 48, 50), 4);
  const f = fretted(spots);
  assert.ok(Math.max(...f) - Math.min(...f) <= 4, "frets used: " + f.join(","));
});

test("a repeated note stays on the same string and fret", () => {
  const spots = Fret.finger(line(40, 40, 40, 40, 33, 40, 40), 4);
  const e2 = spots.filter((_, i) => i !== 4);
  assert.ok(e2.every((s) => s.string === e2[0].string && s.fret === e2[0].fret), JSON.stringify(spots));
});

test("a note the bass cannot reach is moved by octaves and flagged", () => {
  assert.deepStrictEqual(Fret.playable(20, 4), { midi: 32, folded: true });
  assert.deepStrictEqual(Fret.playable(24, 5), { midi: 24, folded: false }); // C1 is on the low B string
  assert.deepStrictEqual(Fret.playable(70, 4), { midi: 58, folded: true });
  const [spot] = Fret.finger(line(20), 4);
  assert.ok(spot.folded);
  assert.strictEqual(Fret.tuning(4)[spot.string] + spot.fret, 32);
});

test("the neck shows frets 0 to 12, more only when the line needs it", () => {
  assert.strictEqual(Fret.shownFrets([{ fret: 3 }, { fret: 7 }]), 12);
  assert.strictEqual(Fret.shownFrets([{ fret: 15 }]), 16);
  assert.strictEqual(Fret.stringNames(5).join(""), "BEADG");
});

test("a whole song is fingered quickly", () => {
  const notes = [];
  for (let i = 0; i < 3000; i++) notes.push({ midi: 28 + ((i * 7) % 24), start: i * 0.2 });
  const began = Date.now();
  Fret.finger(notes, 5);
  assert.ok(Date.now() - began < 1500, "took " + (Date.now() - began) + " ms");
});

test("the first notes set the hand where the rest of the line sits", () => {
  // E2 first: on the D string at fret 2 (hand at the nut), not A7 with a jump back
  const spots = Fret.finger([{ midi: 40, start: 0 }, { midi: 38, start: 1 }, { midi: 40, start: 1.25 }, { midi: 43, start: 1.5 }, { midi: 40, start: 1.75 }], 4);
  assert.ok(spots.every((s) => s.fret <= 5), JSON.stringify(spots));
});
