const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Run the UI with a small DOM and engine double; no browser or audio device needed.
function ui(standalone = false) {
  function element() {
    const listeners = {};
    return {
      listeners, textContent: "", value: "", classList: { toggle() {} },
      addEventListener(name, fn) { listeners[name] = fn; },
      setAttribute() {}, appendChild() {},
      getBoundingClientRect() { return { width: 960, height: 378 }; },
      getContext() { return { setTransform() {} }; },
      showModal() { this.open = true; },
      scrollIntoView() { this.scrolled = true; }
    };
  }
  const elements = Object.fromEntries([...fs.readFileSync("index.html", "utf8").matchAll(/id="([^"]+)"/g)].map(m => [m[1], element()]));
  const body = element(), events = {};
  const engine = {
    pause() {}, setSong() {}, setBuffer() {}, setGuide() {}, setMixVolume() {}, setGuideVolume() {},
    isPlaying() { return false; }, duration() { return 20; }, getLoop() { return null; },
    position() { return 3; }, setLoop() {}
  };
  const window = {
    TprMidi: {}, TprLayout: { FIRST: 28, pickLow() { return 28; } },
    TprSource: { extractCode() { return {}; }, readConfig() { return null; } },
    TprEngine: { create() { return engine; } },
    addEventListener(name, fn) { events[name] = fn; },
    matchMedia() { return { matches: standalone }; }
  };
  vm.runInNewContext(fs.readFileSync("js/app.js", "utf8"), {
    window, document: {
      getElementById(id) { return elements[id]; }, querySelector() { return body; },
      querySelectorAll() { return []; }, createElement: element, addEventListener() {}, documentElement: {}
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
