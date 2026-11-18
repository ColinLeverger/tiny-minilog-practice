/* Keyboard geometry for a 25-key E-to-E keyboard (Korg Monologue), and the
 * rule that places a song's notes on it. */
(function (root) {
  "use strict";
  var KEYS = 25, FIRST = 4; // 25 keys, the lowest is an E
  var BLACK = { 1: true, 3: true, 6: true, 8: true, 10: true };

  function isBlack(midi) { return !!BLACK[((midi % 12) + 12) % 12]; }

  /* Lowest key (always an E) of the two-octave window that holds the most notes.
   * On a tie, the window that starts in the octave of the lowest note wins, so
   * a bass line sits at the left of the keyboard. */
  function pickLow(notes) {
    if (!notes.length) return 28;
    var min = Infinity;
    notes.forEach(function (n) { if (n.midi < min) min = n.midi; });
    var best = FIRST, bestCount = -1;
    for (var low = FIRST; low <= 100; low += 12) {
      var count = 0;
      for (var i = 0; i < notes.length; i++) if (notes[i].midi >= low && notes[i].midi < low + KEYS) count++;
      if (count > bestCount || (count === bestCount && low <= min)) { best = low; bestCount = count; }
    }
    return best;
  }

  /* Where a note is played on the window. A note outside it is moved by whole
   * octaves and flagged, so the player still gets a key to press. */
  function place(midi, low) {
    var key = midi, high = low + KEYS - 1;
    while (key < low) key += 12;
    while (key > high) key -= 12;
    return { key: key, folded: key !== midi };
  }

  /* One rectangle per key, in drawing units. Black keys sit across the gap
   * between their two white neighbours. */
  function keys(low, width) {
    var whites = 0, i;
    for (i = 0; i < KEYS; i++) if (!isBlack(low + i)) whites++;
    var w = width / whites, bw = w * 0.62, out = [], white = 0;
    for (i = 0; i < KEYS; i++) {
      var midi = low + i;
      if (isBlack(midi)) out.push({ midi: midi, black: true, x: white * w - bw / 2, w: bw });
      else { out.push({ midi: midi, black: false, x: white * w, w: w }); white++; }
    }
    return out;
  }

  var api = { KEYS: KEYS, FIRST: FIRST, isBlack: isBlack, pickLow: pickLow, place: place, keys: keys };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprLayout = api;
})(typeof window !== "undefined" ? window : globalThis);
