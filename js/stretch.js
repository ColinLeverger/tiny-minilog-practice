/* Slow a recording down without changing its pitch (WSOLA: overlap-add of
 * short windows, each one slid a little to line up with the previous one so
 * the waveform stays continuous). Good enough to practise against; artefacts
 * grow as the speed drops. */
(function (root) {
  "use strict";
  var N = 2048, HOP = N / 2, DELTA = 256;
  var WINDOW = new Float32Array(N);
  for (var w = 0; w < N; w++) WINDOW[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / N); // sums to 1 at 50% overlap

  /* How well the window at `candidate` continues the one at `target`. */
  function score(x, target, candidate) {
    var dot = 0, energy = 1e-9, len = x.length;
    for (var i = 0; i < N; i += 16) {
      var a = target + i < len ? x[target + i] : 0, b = x[candidate + i];
      dot += a * b; energy += b * b;
    }
    return dot / Math.sqrt(energy);
  }
  function best(x, target, ideal) {
    var lo = Math.max(0, ideal - DELTA), hi = Math.min(x.length - N, ideal + DELTA);
    if (hi < lo) return Math.max(0, Math.min(ideal, x.length - 1));
    var pick = lo, top = -Infinity, c, s;
    for (c = lo; c <= hi; c += 4) { s = score(x, target, c); if (s > top) { top = s; pick = c; } }
    var from = Math.max(lo, pick - 3), to = Math.min(hi, pick + 3);
    for (c = from; c <= to; c++) { s = score(x, target, c); if (s > top) { top = s; pick = c; } }
    return pick;
  }

  /* input: Float32Array of samples. speed: 0 < speed <= 1.
   * Returns samples about input.length / speed long. */
  function stretch(input, speed) {
    if (!(speed > 0) || speed >= 1) return input;
    var len = input.length, outLen = Math.ceil(len / speed);
    var out = new Float32Array(outLen + N), previous = 0;
    for (var k = 0; ; k++) {
      var at = k * HOP, ideal = Math.round(k * HOP * speed);
      if (ideal >= len || at >= outLen) break;
      var pos = k === 0 ? 0 : best(input, previous + HOP, ideal);
      var end = Math.min(N, len - pos);
      for (var i = 0; i < end; i++) out[at + i] += input[pos + i] * WINDOW[i];
      previous = pos;
    }
    return out.subarray(0, outLen);
  }

  var api = { stretch: stretch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprStretch = api;
})(typeof window !== "undefined" ? window : globalThis);
