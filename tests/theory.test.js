const test = require("node:test");
const assert = require("node:assert/strict");
const Theory = require("../js/theory.js");

const line = (pitches, length = 0.5) => pitches.map((midi, i) => ({ midi, start: i * length, end: (i + 1) * length }));

test("a bass line in E minor is found to be in E minor", () => {
  // E G A B D E, held roots: the classic minor-pentatonic bass riff
  const key = Theory.detect(line([28, 28, 31, 33, 35, 38, 40, 28, 28, 33, 31, 28]));
  assert.equal(key.name, "E minor");
  assert.deepEqual(key.scale, [4, 6, 7, 9, 11, 0, 2]);
});

test("a C major line is found to be in C major", () => {
  const key = Theory.detect(line([36, 40, 43, 36, 41, 45, 43, 47, 36, 43, 40, 36]));
  assert.equal(key.name, "C major");
});

test("a held note weighs more than a passing one", () => {
  // A held 4 s and E held 2 s, with quick C# and G# fills: counted note by
  // note this reads as C# minor; by time it is A major.
  const notes = [
    { midi: 33, start: 0, end: 4 }, { midi: 37, start: 4, end: 4.1 }, { midi: 37, start: 4.1, end: 4.2 }, { midi: 37, start: 4.2, end: 4.3 },
    { midi: 40, start: 4.3, end: 6 }, { midi: 44, start: 6, end: 6.1 }, { midi: 44, start: 6.1, end: 6.2 }
  ];
  assert.equal(Theory.detect(notes).name, "A major");
});

test("no notes, no key", () => {
  assert.equal(Theory.detect([]), null);
});

test("songs.json can name the key in the usual ways", () => {
  assert.equal(Theory.parse("E minor").name, "E minor");
  assert.equal(Theory.parse("Em").name, "E minor");
  assert.equal(Theory.parse("f#").name, "F# major");
  assert.equal(Theory.parse("Bb major").name, "Bb major");
  assert.equal(Theory.parse("c# min").name, "C# minor");
  assert.equal(Theory.parse("Cb").tonic, 11);
  assert.equal(Theory.parse("H"), null);
  assert.equal(Theory.parse(""), null);
});

test("notes in the key and the key note are told apart at any octave", () => {
  const key = Theory.parse("E minor");
  assert.equal(Theory.inKey(key, 28), true);  // E1
  assert.equal(Theory.inKey(key, 30), true);  // F#1
  assert.equal(Theory.inKey(key, 29), false); // F1
  assert.equal(Theory.isTonic(key, 52), true);
  assert.equal(Theory.isTonic(key, 31), false);
  assert.equal(Theory.inKey(null, 28), false);
});
