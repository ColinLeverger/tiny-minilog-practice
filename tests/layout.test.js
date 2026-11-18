const test = require("node:test");
const assert = require("node:assert");
const Layout = require("../js/layout.js");
const notes = (...list) => list.map((midi) => ({ midi }));

test("a bass line sits in the left octave of the keyboard", () => {
  assert.strictEqual(Layout.pickLow(notes(28, 31, 43)), 24); // E1..G2 -> window starts at C1
  assert.strictEqual(Layout.pickLow(notes(36, 72)), 36);     // exactly three octaves, C to C
});

test("when the line is wider than the keyboard, the window keeps the most notes", () => {
  assert.strictEqual(Layout.pickLow(notes(24, 50, 52, 55, 57, 62, 64)), 36);
});

test("a note outside the window is moved by octaves and flagged", () => {
  assert.deepStrictEqual(Layout.place(40, 24), { key: 40, folded: false });
  assert.deepStrictEqual(Layout.place(60, 24), { key: 60, folded: false }); // top C is on the keyboard
  assert.deepStrictEqual(Layout.place(61, 24), { key: 49, folded: true });
  assert.deepStrictEqual(Layout.place(23, 24), { key: 35, folded: true });
});

test("the keyboard has 37 keys, 22 white, filling the width", () => {
  const keys = Layout.keys(24, 2200);
  assert.strictEqual(keys.length, 37);
  const white = keys.filter((k) => !k.black);
  assert.strictEqual(white.length, 22);
  assert.strictEqual(white[0].x, 0);
  assert.strictEqual(white[21].x + white[21].w, 2200);
  const cSharp = keys[1];
  assert.ok(cSharp.black && cSharp.x < 100 && cSharp.x + cSharp.w > 100, "C# straddles the C/D gap");
});
