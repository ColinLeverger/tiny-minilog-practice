const test = require("node:test");
const assert = require("node:assert");
const { stretch, stretchAsync } = require("../js/stretch.js");

test("prepared in slices, the slowed copy is the same, and is dropped once stale", async () => {
  const x = new Float32Array(22050 * 20);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i / 7) * Math.sin(i / 3001);
  let slices = 0;
  const sliced = await stretchAsync(x, 0.7, () => { slices++; return false; }, 2);
  assert.ok(slices > 3, `${slices} slices`);
  // compared without assert's diff: printing 630 000 samples runs out of memory
  const whole = stretch(x, 0.7);
  assert.ok(sliced.length === whole.length && sliced.every((v, i) => v === whole[i]), "sliced result differs");
  let asked = 0;
  const dropped = await stretchAsync(x, 0.7, () => ++asked > 2, 2);
  assert.ok(dropped === null, "a stale preparation still delivered a result");
  assert.strictEqual(asked, 3, "kept working after the result became stale");
});

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

/* Timing. A 2.5-minute bed of tones with a sharp click every 1.37 s (and one
 * 20 ms in): at speed s, a click at song time t must come out at t / s, at the
 * start, the middle and the end alike. The tolerance is the search window of
 * the algorithm (256 samples, 5.8 ms); the mean must sit near zero, or every
 * note of the slowed song is early or late by the same amount. */
const CD = 44100;
function clicked(seconds) {
  const x = new Float32Array(CD * seconds), clicks = [0.02];
  for (let t = 1; t < seconds - 1; t += 1.37) clicks.push(t);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * 110 * i / CD) + 0.1 * Math.sin(2 * Math.PI * 277 * i / CD);
  for (const t of clicks) { const c = Math.round(t * CD); for (let j = 0; j < 44; j++) x[c + j] += (j % 2 ? -1 : 1) * Math.exp(-j / 10); }
  return { x, clicks };
}
/* Centre of the click's energy (first difference, which mutes the tones),
 * within ±60 ms of where it should be. */
function heardAt(y, expected) {
  const c = Math.round(expected * CD), w = Math.round(0.06 * CD);
  let sum = 0, moment = 0;
  for (let i = Math.max(1, c - w); i < Math.min(y.length, c + w); i++) { const d = (y[i] - y[i - 1]) ** 2; sum += d; moment += d * i; }
  return moment / sum / CD;
}
const song = clicked(150);
for (const speed of [0.9, 0.8, 0.7, 0.6, 0.5]) {
  test(`at ${Math.round(speed * 100)}% every click lands at its song time / speed, start to end`, () => {
    const y = stretch(song.x, speed);
    const errors = song.clicks.map((t) => (heardAt(y, t / speed) - t / speed) * 1000);
    const worst = errors.reduce((m, e, i) => (Math.abs(e) > Math.abs(errors[m]) ? i : m), 0);
    assert.ok(Math.abs(errors[worst]) < 7,
      `click at ${song.clicks[worst].toFixed(2)} s is off by ${errors[worst].toFixed(1)} ms`);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    assert.ok(Math.abs(mean) < 3, `clicks are off by ${mean.toFixed(1)} ms on average`);
  });
}
