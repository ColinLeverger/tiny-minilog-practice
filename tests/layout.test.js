const test = require("node:test");
const assert = require("node:assert");
const Layout = require("../js/layout.js");
const notes = (...list) => list.map((midi) => ({ midi }));

test("a bass line sits at the left of the keyboard, which starts on an E", () => {
  assert.strictEqual(Layout.pickLow(notes(33, 40, 47)), 28); // A1..B2 -> window starts at E1
  assert.strictEqual(Layout.pickLow(notes(40, 64)), 40);     // exactly two octaves, E to E
});

test("when the line is wider than the keyboard, the window keeps the most notes", () => {
  assert.strictEqual(Layout.pickLow(notes(28, 50, 52, 55, 57, 62, 64)), 40);
});

test("a note outside the window is moved by octaves and flagged", () => {
  assert.deepStrictEqual(Layout.place(40, 28), { key: 40, folded: false });
  assert.deepStrictEqual(Layout.place(52, 28), { key: 52, folded: false }); // top E is on the keyboard
  assert.deepStrictEqual(Layout.place(53, 28), { key: 41, folded: true });
  assert.deepStrictEqual(Layout.place(27, 28), { key: 39, folded: true });
});

test("the keyboard has 25 keys, 15 white, E to E, filling the width", () => {
  const keys = Layout.keys(28, 1500);
  assert.strictEqual(keys.length, 25);
  const white = keys.filter((k) => !k.black);
  assert.strictEqual(white.length, 15);
  assert.strictEqual(white[0].x, 0);
  assert.strictEqual(white[14].x + white[14].w, 1500);
  assert.ok(!keys[0].black && !keys[1].black, "E and F are neighbours with no black key between");
  const fSharp = keys[2];
  assert.ok(fSharp.black && fSharp.x < 200 && fSharp.x + fSharp.w > 200, "F# straddles the F/G gap");
  assert.ok(!keys[24].black, "the top key is an E");
});
