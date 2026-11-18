const test = require("node:test");
const assert = require("node:assert");
const Engine = require("../js/engine.js");

test("starting mid-song resumes with the note that is still sounding", () => {
  const notes = [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }];
  assert.strictEqual(Engine.firstAudible(notes, 0), 0);
  assert.strictEqual(Engine.firstAudible(notes, 1), 1);   // first note just ended
  assert.strictEqual(Engine.firstAudible(notes, 1.5), 1); // second is held
  assert.strictEqual(Engine.firstAudible(notes, 9), 3);
});

test("MIDI notes map to pitch", () => {
  assert.strictEqual(Engine.frequency(69), 440);
  assert.ok(Math.abs(Engine.frequency(28) - 41.2034) < 0.001); // E1, the low bass string
});
