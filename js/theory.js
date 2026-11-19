/* The key of a song, and the notes that belong to it, so the player can
 * improvise around the line without a theory lesson. */
(function (root) {
  "use strict";
  var NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
  // Krumhansl-Kessler key profiles: how strongly each degree belongs to a key.
  var PROFILE = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  };

  function pc(midi) { return ((midi % 12) + 12) % 12; }

  function make(tonic, minor) {
    return {
      tonic: tonic, minor: minor,
      name: NAMES[tonic] + (minor ? " minor" : " major"),
      scale: (minor ? MINOR : MAJOR).map(function (step) { return (tonic + step) % 12; })
    };
  }

  function correlation(a, b) {
    var ma = 0, mb = 0, i;
    for (i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) * (a[i] - ma); db += (b[i] - mb) * (b[i] - mb); }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  var REGULAR = 3; // a note played this many times belongs to the key

  /* Best-matching key for notes [{ midi, start, end }]. Each note counts by
   * how long it sounds, so a held root weighs more than a passing note.
   * Only keys that hold every note the line plays regularly are considered:
   * the dots must never skip a note the player hears again and again, even
   * when it is short (REBEL: four short F# among long As and Es read as
   * A minor, which has no F#). A note played once or twice is a passing note
   * and does not count; when no key holds them all, every key competes. */
  function detect(notes) {
    var weight = new Array(12).fill(0), count = new Array(12).fill(0);
    (notes || []).forEach(function (n) {
      weight[pc(n.midi)] += Math.max(0.05, (n.end - n.start) || 0);
      count[pc(n.midi)]++;
    });
    if (!weight.some(Boolean)) return null;
    function holdsAll(tonic, minor) {
      var scale = make(tonic, minor).scale;
      return count.every(function (c, p) { return c < REGULAR || scale.indexOf(p) >= 0; });
    }
    var strict = false;
    for (var t = 0; t < 12 && !strict; t++) strict = holdsAll(t, false) || holdsAll(t, true);
    var best = null;
    for (var tonic = 0; tonic < 12; tonic++) {
      ["major", "minor"].forEach(function (kind) {
        if (strict && !holdsAll(tonic, kind === "minor")) return;
        var rotated = weight.slice(tonic).concat(weight.slice(0, tonic));
        var score = correlation(rotated, PROFILE[kind]);
        if (!best || score > best.score) best = { tonic: tonic, minor: kind === "minor", score: score };
      });
    }
    return make(best.tonic, best.minor);
  }

  /* "E minor", "Em", "F#", "Bb major", "c# min" -> key, or null. */
  function parse(text) {
    var m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|maj|major)?\s*$/.exec(String(text || ""));
    if (!m) return null;
    var tonic = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    if (m[2] === "#" || m[2] === "♯") tonic += 1;
    if (m[2] === "b" || m[2] === "♭") tonic -= 1;
    var minor = m[3] === "m" || /^min/i.test(m[3] || "");
    return make(pc(tonic), minor);
  }

  function inKey(key, midi) { return !!key && key.scale.indexOf(pc(midi)) >= 0; }
  function isTonic(key, midi) { return !!key && pc(midi) === key.tonic; }

  var api = { NAMES: NAMES, detect: detect, parse: parse, inKey: inKey, isTonic: isTonic };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprTheory = api;
})(typeof window !== "undefined" ? window : globalThis);
