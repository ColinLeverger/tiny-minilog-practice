const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const I18n = require("../js/i18n.js");
const fr = I18n.create("fr"), en = I18n.create("en");

test("the browser's first language decides, and ?lang= forces one", () => {
  assert.equal(I18n.pick(["fr-FR", "en"], "https://x/"), "fr");
  assert.equal(I18n.pick(["fr"], "https://x/"), "fr");
  assert.equal(I18n.pick(["en-GB", "fr"], "https://x/"), "en");
  assert.equal(I18n.pick(["de"], "https://x/"), "en");
  assert.equal(I18n.pick([undefined], "https://x/"), "en");
  assert.equal(I18n.pick(["en"], "https://x/?lang=fr"), "fr");
  assert.equal(I18n.pick(["fr"], "https://x/#v=bass&lang=en"), "en");
  // the Settings choice beats the browser, the address beats both
  assert.equal(I18n.pick(["fr-FR"], "https://x/", "en"), "en");
  assert.equal(I18n.pick(["en-US"], "https://x/", "fr"), "fr");
  assert.equal(I18n.pick(["en-US"], "https://x/?lang=en", "fr"), "en");
  assert.equal(I18n.pick(["fr-FR"], "https://x/", "garbage"), "fr");
});

test("English stays English; French replaces whole sentences and fills templates", () => {
  assert.equal(en.t("With bass"), "With bass");
  assert.equal(fr.t("With bass"), "Avec basse");
  assert.equal(fr.t("Saving songs on this device: 3 of 12 files…"), "Enregistrement des morceaux sur cet appareil : 3 fichiers sur 12…");
  assert.equal(fr.t("Not found in the data repository: rebel/full.mp3"), "Introuvable dans le dépôt des morceaux : rebel/full.mp3");
  assert.equal(fr.t("Loading REBEL…"), "Chargement de REBEL…");
  assert.equal(fr.t("A song title nobody translates"), "A song title nobody translates");
  assert.equal(fr.t(""), "");
});

test("keys are named the French way", () => {
  const Theory = require("../js/theory.js");
  assert.equal(fr.keyName(Theory.parse("E minor")), "mi mineur");
  assert.equal(fr.keyName(Theory.parse("F# major")), "fa♯ majeur");
  assert.equal(fr.tonicName(Theory.parse("Bb")), "si♭");
  assert.equal(en.keyName(Theory.parse("E minor")), "E minor");
  assert.equal(fr.t("This song is in mi mineur. Dots mark the notes that fit it; the ringed dot is mi, the home note."),
    "Ce morceau est en mi mineur. Les points marquent les notes qui vont avec ; le point cerclé marque la note de repos (mi).");
});

/* Drift guard: a sentence added in English without its French shows up
 * here, not on the friend's tablet. */
test("every text of the page has a French version", () => {
  const html = fs.readFileSync("index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const body = html.slice(html.indexOf("<body>"));
  const texts = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim())
    .concat([...body.matchAll(/(?:aria-label|placeholder)="([^"]+)"/g)].map((m) => m[1]))
    .map((s) => s.replace(/&amp;/g, "&"))
    .filter((s) => /[a-z]{2}/i.test(s) && s !== "main"); // the branch placeholder is a branch name
  const same = ["Volume", "Position", "Pause", // spelled the same in French
    "English", "Français", "Language / Langue"]; // the language switch reads the same in both
  const missing = [...new Set(texts)].filter((s) => fr.t(s) === s && !same.includes(s));
  assert.deepEqual(missing, []);
});

test("every message the code can show has a French version", () => {
  const code = ["js/app.js", "js/source.js", "js/midi.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  // whole sentences only: Error("…") and status("…") literals that end the message
  const literals = [...code.matchAll(/(?:Error|status|textContent = t)\(\s*"([^"]+[.…])"\s*\)/g)].map((m) => m[1]);
  assert.ok(literals.length > 20, "found " + literals.length);
  const missing = [...new Set(literals)].filter((s) => fr.t(s) === s);
  assert.deepEqual(missing, []);
});
