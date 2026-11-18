const test = require("node:test");
const assert = require("node:assert");
const Midi = require("../js/midi.js");

function varlen(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
function chunk(id, body) {
  const n = body.length;
  return [...id].map((c) => c.charCodeAt(0)).concat([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], body);
}
function file(division, tracks) {
  return new Uint8Array(chunk("MThd", [0, 1, 0, tracks.length, division >> 8, division & 255]).concat(...tracks.map((t) => chunk("MTrk", t))));
}
const END = [0, 0xff, 0x2f, 0];
const tempo = (delta, us) => [...varlen(delta), 0xff, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);

test("notes come out in seconds, following a tempo change", () => {
  // 480 ticks per beat. 120 bpm for one beat, then 60 bpm.
  const song = Midi.parse(file(480, [
    [...tempo(0, 500000), ...tempo(480, 1000000), ...END],
    [
      0, 0x90, 40, 100, ...varlen(240), 0x80, 40, 0,      // 0.00 -> 0.25 s
      ...varlen(240), 0x90, 43, 90, ...varlen(480), 0x80, 43, 0, // 0.50 -> 1.50 s (after the change)
      ...END
    ]
  ]));
  assert.strictEqual(song.notes.length, 2);
  near(song.notes[0].start, 0); near(song.notes[0].end, 0.25);
  near(song.notes[1].start, 0.5); near(song.notes[1].end, 1.5);
  near(song.duration, 1.5);
  assert.strictEqual(song.bpm, 120);
  assert.strictEqual(song.notes[1].midi, 43);
  assert.strictEqual(song.notes[1].velocity, 90);
});

test("running status and note-on with velocity 0 are read as most DAWs write them", () => {
  const song = Midi.parse(file(96, [[
    0, 0x90, 36, 100,
    96, 36, 0,          // running status, velocity 0 = note off
    0, 38, 100,         // running status, new note
    96, 38, 0,
    ...END
  ]]));
  assert.deepStrictEqual(song.notes.map((n) => [n.midi, n.start, n.end]), [[36, 0, 0.5], [38, 0.5, 1]]);
});

test("beats mark the bars from the time signature", () => {
  const song = Midi.parse(file(96, [[
    0, 0xff, 0x58, 4, 3, 2, 24, 8,   // 3/4
    0, 0x90, 36, 100, ...varlen(96 * 6), 0x80, 36, 0,
    ...END
  ]]));
  assert.deepStrictEqual(song.beats.slice(0, 4).map((b) => b.bar), [true, false, false, true]);
  near(song.beats[3].time, 1.5);
});

test("a file that is not MIDI, or cut short, is refused with a readable message", () => {
  assert.throws(() => Midi.parse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /Not a MIDI file/);
  const whole = file(96, [[0, 0x90, 36, 100, 96, 0x80, 36, 0, ...END]]);
  assert.throws(() => Midi.parse(whole.subarray(0, whole.length - 5)), /truncated/);
});

test("a file with no tempo uses the tempo given for the song, and says so", () => {
  const bytes = file(96, [[0, 0x90, 36, 100, 96, 0x80, 36, 0, ...END]]);
  const plain = Midi.parse(bytes);
  assert.strictEqual(plain.hasTempo, false);
  near(plain.notes[0].end, 0.5);                           // MIDI default, 120
  near(Midi.parse(bytes, { bpm: 128 }).notes[0].end, 60 / 128);
  const stated = Midi.parse(file(96, [[...tempo(0, 1000000), 0, 0x90, 36, 100, 96, 0x80, 36, 0, ...END]]), { bpm: 128 });
  assert.strictEqual(stated.hasTempo, true);
  near(stated.notes[0].end, 1);                            // the file's own tempo wins
});
