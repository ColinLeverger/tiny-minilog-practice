const test = require("node:test");
const assert = require("node:assert");
const { stretch } = require("../js/stretch.js");

const RATE = 22050;
function sine(freq, seconds) {
  const x = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * freq * i / RATE);
  return x;
}
/* Pitch measured by counting upward zero crossings over a slice. */
function pitch(x, from, to) {
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((to - from) / RATE);
}
function rms(x, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (to - from));
}

test("full speed leaves the recording untouched", () => {
  const x = sine(110, 0.5);
  assert.strictEqual(stretch(x, 1), x);
});

for (const speed of [0.9, 0.7, 0.5]) {
  test(`at ${speed * 100}% the recording lasts longer and keeps its pitch`, () => {
    const x = sine(110, 2), y = stretch(x, speed);
    assert.strictEqual(y.length, Math.ceil(x.length / speed));
    const from = Math.round(0.2 * RATE), to = y.length - Math.round(0.2 * RATE);
    const heard = pitch(y, from, to);
    assert.ok(Math.abs(heard - 110) < 110 * 0.02, `pitch ${heard.toFixed(1)} Hz, expected 110`);
    const level = rms(y, from, to);
    assert.ok(level > 0.6 && level < 0.8, `level ${level.toFixed(3)}, expected about 0.707`);
  });
}
