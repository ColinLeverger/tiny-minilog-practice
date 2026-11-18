/* Bass neck: where to play each note of a line, and how to keep the hand
 * still while doing it. Strings are numbered from the lowest (0). */
(function (root) {
  "use strict";
  var TUNINGS = { 4: [28, 33, 38, 43], 5: [23, 28, 33, 38, 43] }; // E1 A1 D2 G2 (+ B0)
  var NAMES = { 23: "B", 28: "E", 33: "A", 38: "D", 43: "G" };
  var MAX_FRET = 20, SPAN = 3; // one finger per fret: four frets without moving the hand

  function tuning(strings) { return TUNINGS[strings] || TUNINGS[4]; }
  function stringNames(strings) { return tuning(strings).map(function (m) { return NAMES[m]; }); }

  /* A note the bass cannot reach is moved by octaves, and flagged. */
  function playable(midi, strings) {
    var t = tuning(strings), low = t[0], high = t[t.length - 1] + MAX_FRET, folded = false;
    while (midi < low) { midi += 12; folded = true; }
    while (midi > high) { midi -= 12; folded = true; }
    return { midi: midi, folded: folded };
  }

  /* Effort of one position on its own: low frets are easier to find. */
  function placeCost(fret) { return fret * 0.03 + (fret > 12 ? (fret - 12) * 0.1 : 0); }

  /* The hand is a window of SPAN + 1 frets, from the index finger (`hand`)
   * to the little finger. A fretted note inside the window costs nothing; one
   * outside moves the window just enough to reach it, which costs more the
   * further it moves, less so when there is time to move. Open strings leave
   * the hand where it is. */
  function shift(from, fret) {
    if (fret >= from && fret <= from + SPAN) return { hand: from, cost: 0 };
    var to = fret < from ? fret : fret - SPAN;
    return { hand: to, cost: 1 + Math.abs(to - from) * 0.5 };
  }

  /* notes: [{ midi, start }] in time order. Returns, for each note,
   * { string, fret, folded }. Cheapest whole path (dynamic programming over
   * every playable spot of every note, with the hand window as part of the
   * state). */
  function finger(notes, strings) {
    var t = tuning(strings), layers = [], prevStates = [{ string: null, hand: null, cost: 0, back: null }];
    for (var n = 0; n < notes.length; n++) {
      var p = playable(notes[n].midi, strings), gap = n ? notes[n].start - notes[n - 1].start : 1;
      var next = {};
      for (var s = 0; s < t.length; s++) {
        var fret = p.midi - t[s];
        if (fret < 0 || fret > MAX_FRET) continue;
        for (var i = 0; i < prevStates.length; i++) {
          var prev = prevStates[i], base = prev.cost + placeCost(fret), moves;
          if (fret === 0) moves = [{ hand: prev.hand, cost: 0.35 }];
          else if (prev.hand == null) { // nothing fretted yet: the hand may sit anywhere that reaches it
            moves = [];
            for (var h = Math.max(1, fret - SPAN); h <= fret; h++) moves.push({ hand: h, cost: 0 });
          } else moves = [shift(prev.hand, fret)];
          if (prev.string != null) base += Math.abs(s - prev.string) * 0.15;
          for (var j = 0; j < moves.length; j++) {
            var hand = moves[j].hand, cost = base + (gap > 0.5 ? moves[j].cost * 0.6 : moves[j].cost);
            var key = s + ":" + fret + ":" + hand;
            if (!next[key] || cost < next[key].cost) {
              next[key] = { string: s, fret: fret, hand: hand, cost: cost, back: prev, folded: p.folded };
            }
          }
        }
      }
      prevStates = Object.keys(next).map(function (k) { return next[k]; });
      layers.push(prevStates);
    }
    var out = new Array(notes.length), bestState = null;
    if (!notes.length) return out;
    layers[layers.length - 1].forEach(function (st) { if (!bestState || st.cost < bestState.cost) bestState = st; });
    for (var k = notes.length - 1; k >= 0; k--) {
      out[k] = { string: bestState.string, fret: bestState.fret, folded: bestState.folded };
      bestState = bestState.back;
    }
    return out;
  }

  /* Frets to draw: always 0 to 12, more if the line goes higher. */
  function shownFrets(spots) {
    var top = 12;
    spots.forEach(function (s) { if (s && s.fret + 1 > top) top = s.fret + 1; });
    return Math.min(top, MAX_FRET);
  }

  var api = {
    TUNINGS: TUNINGS, MAX_FRET: MAX_FRET, tuning: tuning, stringNames: stringNames,
    playable: playable, finger: finger, shownFrets: shownFrets
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprFretboard = api;
})(typeof window !== "undefined" ? window : globalThis);
