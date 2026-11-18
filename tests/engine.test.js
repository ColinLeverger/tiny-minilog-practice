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

/* ---------- the engine against a fake Web Audio clock ----------
 * The fake records when each recording source and each guide-bass oscillator
 * is told to start and stop, and the test moves the clock by hand. From that
 * we know what song time the speaker plays at any instant, and compare it
 * with engine.position(), which the picture follows. */
function fakeAudio() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const node = (extra) => Object.assign({ connect() {}, disconnect() {} }, extra);
  const log = { sources: [], voices: [] };
  const ctx = {
    currentTime: 0, state: "running", outputLatency: 0, destination: node(),
    resume() { return Promise.resolve(); },
    createDynamicsCompressor: () => node({ threshold: param(), ratio: param(), attack: param(), release: param() }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ frequency: param(), Q: param() }),
    createOscillator() {
      const o = node({ frequency: param(), startAt: null, stopAt: Infinity,
        start(t) { this.startAt = t; }, stop(t) { this.stopAt = Math.min(this.stopAt, t); } });
      log.voices.push(o); return o;
    },
    createBufferSource() {
      const s = node({ buffer: null, when: null, offset: null, stopAt: Infinity,
        start(when, offset) { this.when = when; this.offset = offset; },
        stop(t) { this.stopAt = Math.min(this.stopAt, t === undefined ? ctx.currentTime : t); } });
      log.sources.push(s); return s;
    },
    createBuffer: (channels, length, rate) => ({ duration: length / rate, length, sampleRate: rate, copyToChannel() {} })
  };
  return { ctx, log };
}
/* An engine on the fake clock. Its 50 ms timer runs only when the test
 * advances the clock. */
function rig(t) {
  const { ctx, log } = fakeAudio();
  let tick = null;
  const saved = { AudioContext: globalThis.AudioContext, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  globalThis.AudioContext = function () { return ctx; };
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  t.after(() => Object.assign(globalThis, saved));
  const engine = Engine.create();
  function advance(seconds) {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 0.05);
      if (tick) tick();
    }
  }
  /* `seconds` of song recording, as stretched for `speed`. */
  function recording(seconds, speed) { return engine.makeBuffer(new Float32Array(Math.ceil(seconds * 48000 / speed)), 48000); }
  /* Song time coming out of the speaker now, from the one live source. */
  function heard(speed, offset) {
    const now = ctx.currentTime;
    const live = log.sources.filter((s) => s.when !== null && s.when <= now && now < s.stopAt);
    assert.strictEqual(live.length, 1, `${live.length} recordings sound at once`);
    return (live[0].offset + (now - live[0].when)) * speed - offset;
  }
  return { ctx, log, engine, advance, recording, heard };
}
function notesEvery(step, until) {
  const notes = [];
  for (let s = 0; s < until; s += step) notes.push({ start: s, end: s + step * 0.5, midi: 40, velocity: 100 });
  return { notes, duration: until };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b}`);

test("slowed playback: recording, picture and guide bass agree on the song time", async (t) => {
  const r = rig(t), offset = 0.05, speed = 0.6;
  r.engine.setSong(notesEvery(0.5, 60));
  r.engine.setBuffer(r.recording(60 + offset, speed), offset, speed);
  r.engine.seek(10);
  await r.engine.play();
  for (let i = 0; i < 8; i++) {
    r.advance(1.37);
    near(r.heard(speed, offset), r.engine.position(), 1e-6, "recording vs picture");
  }
  const when = r.log.sources[0].when, sines = r.log.voices.filter((o, i) => i % 3 === 0);
  assert.ok(sines.length >= 13, `${sines.length} guide notes in 6.6 song seconds`);
  sines.forEach((o) => {
    const songTime = 10 + (o.startAt - when) * speed;
    near(songTime * 2, Math.round(songTime * 2), 1e-6, "a guide note starts between two notes"); // notes every 0.5 s
  });
});

test("changing speed while playing keeps the song where it was and drops the old schedule", async (t) => {
  const r = rig(t), offset = 0.04;
  r.engine.setSong(notesEvery(0.5, 60));
  r.engine.setBuffer(r.recording(60 + offset, 1), offset, 1);
  await r.engine.play();
  r.advance(5);
  for (const speed of [0.9, 0.5, 1, 0.7]) {
    const before = r.engine.position(), now = r.ctx.currentTime, planned = r.log.voices.slice();
    r.engine.setBuffer(r.recording(60 + offset, speed), offset, speed);
    planned.filter((o) => o.startAt > now + 0.06).forEach((o) =>
      assert.ok(o.stopAt <= o.startAt + 1e-9, "a guide note planned at the old speed still sounds"));
    r.advance(0.06);
    near(r.engine.position(), before, 1e-6, `song position after switching to ${speed}`);
    r.advance(2.3);
    near(r.heard(speed, offset), r.engine.position(), 1e-6, `recording vs picture at ${speed}`);
    near(r.engine.position(), before + 2.3 * speed, 1e-6, `song advances at ${speed}`);
  }
});

test("pause, change speed, play resumes where it paused", async (t) => {
  const r = rig(t), offset = 0.03;
  r.engine.setSong(notesEvery(0.5, 60));
  r.engine.setBuffer(r.recording(60 + offset, 1), offset, 1);
  await r.engine.play();
  r.advance(4); r.engine.pause();
  const at = r.engine.position();
  r.advance(3);
  r.engine.setBuffer(r.recording(60 + offset, 0.5), offset, 0.5);
  near(r.engine.position(), at, 1e-9, "paused position");
  await r.engine.play(); r.advance(2.06);
  near(r.engine.position(), at + 2 * 0.5, 1e-6, "position after play");
  near(r.heard(0.5, offset), r.engine.position(), 1e-6, "recording vs picture");
});

test("loop, seek and −5 s work in song seconds at a slowed speed", async (t) => {
  const r = rig(t), offset = 0.05, speed = 0.5;
  r.engine.setSong(notesEvery(0.5, 60));
  r.engine.setBuffer(r.recording(60 + offset, speed), offset, speed);
  r.engine.setLoop(20, 24);
  r.engine.seek(20);
  await r.engine.play();
  let wrapped = 0, last = r.engine.position();
  for (let i = 0; i < 400; i++) {
    r.advance(0.05);
    const p = r.engine.position();
    if (p < last) wrapped++;
    assert.ok(p < 24 + 0.05 * speed + 1e-9, `played past B: ${p}`);
    last = p;
  }
  assert.ok(wrapped >= 2, `looped ${wrapped} times in 20 s at 50% over a 4 s loop`);
  r.engine.setLoop(null, null);
  r.engine.seek(r.engine.position() - 5);
  r.advance(1.06);
  near(r.heard(speed, offset), r.engine.position(), 1e-6, "after −5 s");
});

test("the end of a slowed song is detected when the song ends, not before or after", async (t) => {
  const r = rig(t);
  r.engine.setSong(notesEvery(0.5, 10));
  r.engine.setBuffer(r.recording(10, 0.5), 0, 0.5);
  near(r.engine.duration(), 10, 1e-3, "duration in song seconds");
  r.engine.seek(8);
  await r.engine.play();
  r.advance(4); assert.ok(r.engine.isPlaying(), "stopped early");
  r.advance(1); assert.ok(!r.engine.isPlaying(), "never stopped");
});
