const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Run the UI with a small DOM and engine double; no browser or audio device needed.
function ui(standalone = false, options = {}) {
  function element() {
    const listeners = {};
    return {
      listeners, textContent: "", value: "", classList: { toggle() {} },
      addEventListener(name, fn) { listeners[name] = fn; },
      setAttribute() {}, appendChild() {},
      getBoundingClientRect() { return { width: 960, height: 378 }; },
      getContext() { return { setTransform() {} }; },
      showModal() { this.open = true; }, close() { this.open = false; }, dataset: {},
      scrollIntoView() { this.scrolled = true; }
    };
  }
  const elements = Object.fromEntries([...fs.readFileSync("index.html", "utf8").matchAll(/id="([^"]+)"/g)].map(m => [m[1], element()]));
  const body = element(), events = {};
  const engine = {
    pause() {}, setSong() {}, setBuffer() {}, setGuide() {}, setMixVolume() {}, setGuideVolume() {},
    isPlaying() { return false; }, duration() { return 20; }, getLoop() { return null; },
    position() { return 3; }, setLoop() {}, setPlayVolume() {}, ...options.engine
  };
  const window = {
    TprMidi: options.midi || {}, TprStretch: options.stretch, TprTheory: require("../js/theory.js"), TprI18n: require("../js/i18n.js").create("en"), TprLayout: { FIRST: 28, pickLow() { return 28; } },
    TprSource: { extractCode() { return {}; }, readConfig() { return null; } },
    TprEngine: { create() { return engine; } },
    addEventListener(name, fn) { events[name] = fn; },
    matchMedia() { return { matches: standalone }; }
  };
  vm.runInNewContext(fs.readFileSync("js/app.js", "utf8"), {
    window, document: {
      getElementById(id) { return elements[id]; }, querySelector() { return body; },
      querySelectorAll(selector) { return selector === ".modes button" ? options.modes || [] : []; }, createElement: element, addEventListener() {}, documentElement: {}
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: "http://localhost/", protocol: "http:", hostname: "localhost" },
    navigator: {}, requestAnimationFrame() {}, setTimeout, clearTimeout
  });
  return { elements, events, body };
}

test("Install without a browser prompt opens reachable menu instructions", async () => {
  const { elements, body } = ui();
  body.scrollTop = 500;
  await elements.install.listeners.click();
  assert.equal(elements.settings.open, true);
  assert.equal(body.scrollTop, 0);
  assert.equal(elements["install-help"].scrolled, true);
  assert.equal(elements.setup.open, false);
});

test("Install uses a deferred prompt once and falls back after dismissal or failure", async () => {
  for (const outcome of ["accepted", "dismissed", "error"]) {
    const { elements, events } = ui();
    let calls = 0, prevented = false;
    events.beforeinstallprompt({
      preventDefault() { prevented = true; },
      async prompt() { calls++; if (outcome === "error") throw Error("unavailable"); },
      userChoice: Promise.resolve({ outcome })
    });
    await elements.install.listeners.click();
    assert.equal(prevented, true);
    assert.equal(calls, 1);
    assert.equal(!!elements.settings.open, outcome !== "accepted");
    await elements.install.listeners.click();
    assert.equal(calls, 1);
    assert.equal(elements.settings.open, true);
  }
});

test("Installed state is shown after installation and on standalone launch", () => {
  const first = ui();
  first.events.appinstalled();
  for (const elements of [first.elements, ui(true).elements]) {
    assert.equal(elements.install.textContent, "Installed");
    assert.equal(elements.install.disabled, true);
    assert.match(elements["install-message"].textContent, /TinyPiano icon/);
  }
});

test("Unavailable fullscreen gives on-tablet installation instructions", async () => {
  const { elements } = ui();
  await elements.fullscreen.listeners.click();
  assert.equal(elements.settings.open, true);
  assert.equal(elements["install-help"].scrolled, true);
  assert.match(elements["install-message"].textContent, /Full screen is unavailable/);
});

test("Loop end stays disabled until a loop start is set", async () => {
  const { elements } = ui();
  await new Promise(setImmediate);
  assert.equal(elements["loop-b"].disabled, true);
  elements["loop-a"].listeners.click();
  assert.equal(elements["loop-b"].disabled, false);
  assert.equal(elements["loop-a"].textContent, "A 0:03");
  elements["loop-clear"].listeners.click();
  assert.equal(elements["loop-b"].disabled, true);
});

test("the octave buttons grey out at ±2 instead of silently doing nothing", async () => {
  const { elements } = ui();
  await new Promise(setImmediate);
  const up = elements["shift-up"], down = elements["shift-down"];
  assert.equal(up.disabled, false);
  up.listeners.click(); up.listeners.click();
  assert.equal(elements["shift-out"].textContent, "+2");
  assert.equal(up.disabled, true, "Higher must be disabled at +2");
  assert.equal(down.disabled, false);
  for (let i = 0; i < 4; i++) down.listeners.click();
  assert.equal(elements["shift-out"].textContent, "-2");
  assert.equal(down.disabled, true, "Lower must be disabled at -2");
  assert.equal(up.disabled, false);
});

/* ---------- speed ---------- */
const Stretch = require("../js/stretch.js");
const RATE = 44100;
/* A song loaded from this device, with two recordings told apart by their
 * level, and an engine double that logs every buffer it is handed. */
async function slowable(seconds, stretch = Stretch) {
  const level = { backing: 0.25, full: 0.75 };
  const recording = (kind) => {
    const samples = new Float32Array(RATE * seconds).fill(level[kind]);
    return { kind, numberOfChannels: 1, sampleRate: RATE, length: samples.length, duration: seconds, getChannelData: () => samples };
  };
  const decoded = { backing: recording("backing"), full: recording("full") };
  const handed = [];
  const engine = {
    decode: async (bytes) => decoded[bytes.kind],
    makeBuffer: (samples, rate) => ({ samples, rate }),
    setBuffer(buffer, offset, speed) { handed.push({ buffer, offset, speed }); }
  };
  const modes = ["full", "backing", "silent"].map((mode) => ({
    dataset: { mode }, listeners: {}, setAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }));
  const midi = { parse: () => ({ notes: [{ midi: 40, start: 0, end: 1, velocity: 100 }], beats: [] }) };
  const app = ui(false, { engine, stretch, midi, modes });
  const file = (kind) => ({ name: kind + ".mid", arrayBuffer: async () => ({ kind }) });
  app.elements["file-midi"].files = [file("midi")];
  app.elements["file-full"].files = [file("full")];
  app.elements["file-backing"].files = [file("backing")];
  app.elements["file-load"].listeners.click();
  await until(() => handed.some((h) => h.buffer === decoded.backing));
  const tap = (id, times = 1) => { for (let i = 0; i < times; i++) app.elements[id].listeners.click(); };
  const mode = (name) => modes.find((m) => m.dataset.mode === name).listeners.click();
  return { ...app, handed, decoded, tap, mode, last: () => handed[handed.length - 1] };
}
async function until(done, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Which recording a buffer handed to the engine was made from. */
const madeFrom = (buffer) => !buffer ? null : buffer.kind || (buffer.samples[buffer.samples.length >> 1] > 0.5 ? "full" : "backing");

test("a slower copy is prepared without freezing the page, then swapped in", async () => {
  const app = await slowable(240);
  let gap = 0, previous = Date.now();
  const probe = setInterval(() => { const now = Date.now(); gap = Math.max(gap, now - previous); previous = now; }, 5);
  app.tap("slower", 5);
  await until(() => app.last().speed === 0.5);
  clearInterval(probe);
  gap = Math.max(gap, Date.now() - previous); // the probe may not have run since the last block
  // Run in one go, the stretch holds the page for its whole length: ~350 ms
  // here, seconds on a tablet, with no guide bass scheduled, no loop and a
  // frozen picture meanwhile.
  assert.ok(gap < 100, `the page was frozen for ${gap} ms`);
  const { buffer, speed, offset } = app.last();
  assert.equal(speed, 0.5);
  assert.equal(offset, 0);
  assert.equal(buffer.samples.length, Math.ceil(RATE * 240 / 0.5));
  assert.equal(madeFrom(buffer), "backing");
  assert.equal(app.elements.status.textContent, "");
});

test("mode, speed and 100% changed during a preparation: the engine ends on the latest choice", async () => {
  // A stretch double the test finishes by hand, so every interleaving is chosen.
  const jobs = [];
  const manual = {
    stretchAsync(input, speed, stale) {
      return new Promise((resolve) => jobs.push({ input, speed, stale, finish: () => resolve(stale() ? null : new Float32Array(Math.ceil(input.length / speed)).fill(input[0])) }));
    }
  };
  const app = await slowable(2, manual);

  // 1. Mode switch while the 90% copy of "backing" is prepared.
  app.tap("slower");
  await until(() => jobs.length === 1);
  assert.match(app.elements.status.textContent, /Preparing/);
  const mark = app.handed.length;
  app.mode("full");
  await until(() => jobs.length === 2);
  jobs[0].finish(); jobs[1].finish();
  await until(() => app.last().speed === 0.9);
  await pause(20);
  assert.deepEqual(app.handed.slice(mark).map((h) => [madeFrom(h.buffer), h.speed]), [["full", 0.9]]);
  assert.equal(app.elements.status.textContent, "");

  // 2. Back to 100% before the 80% copy is ready: the late copy is dropped.
  app.tap("slower");
  await until(() => jobs.length === 3);
  app.tap("faster", 2);
  await until(() => app.last().speed === 1);
  jobs[2].finish();
  await pause(20);
  assert.equal(app.last().buffer, app.decoded.full);
  assert.equal(app.last().speed, 1);
  assert.equal(app.elements.status.textContent, "", "the preparing message stays after going back to 100%");

  // 3. Mode switched inside the speed debounce: one preparation, not two.
  app.tap("slower", 2);
  app.mode("backing");
  await until(() => jobs.length === 4);
  await pause(450); // the speed debounce fires while that preparation runs
  assert.equal(jobs.length, 4, "the same copy was prepared twice");
  jobs[3].finish();
  await until(() => app.last().speed === 0.8);
  assert.equal(madeFrom(app.last().buffer), "backing");

  // 4. Silent chosen while a copy is prepared: no recording, no message left.
  app.tap("slower");
  await until(() => jobs.length === 5);
  app.mode("silent");
  jobs[4].finish();
  await pause(20);
  assert.equal(app.last().buffer, null);
  assert.equal(app.last().speed, 0.7);
  assert.equal(app.elements.status.textContent, "", "the preparing message stays after choosing silent");
});
