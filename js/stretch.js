/* Slow a recording down without changing its pitch (WSOLA: overlap-add of
 * short windows, each one slid a little to line up with the previous one so
 * the waveform stays continuous). Good enough to practise against; artefacts
 * grow as the speed drops.
 *
 * Timing: what sits at song time t in the input comes out at t / speed, to
 * within the search window (DELTA samples, under 6 ms at 44.1 kHz), at any
 * point of the song. Each window is placed so that its *centre* maps exactly,
 * and the search only slides it around that fixed spot, so the error cannot
 * build up from one window to the next. */
(function (root) {
  "use strict";
  var N = 2048, HOP = N / 2, HALF = N / 2, DELTA = 256;
  var WINDOW = new Float32Array(N);
  for (var w = 0; w < N; w++) WINDOW[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / N); // sums to 1 at 50% overlap

  /* Silence before the first sample and after the last one. */
  function at(x, i) { return i >= 0 && i < x.length ? x[i] : 0; }

  /* How well the window at `candidate` continues the one at `target`. */
  function score(x, target, candidate) {
    var dot = 0, energy = 1e-9, i;
    if (target >= 0 && candidate >= 0 && target + N <= x.length && candidate + N <= x.length) {
      for (i = 0; i < N; i += 16) { var p = x[target + i], q = x[candidate + i]; dot += p * q; energy += q * q; }
      return dot / Math.sqrt(energy);
    }
    for (i = 0; i < N; i += 16) {
      var a = at(x, target + i), b = at(x, candidate + i);
      dot += a * b; energy += b * b;
    }
    return dot / Math.sqrt(energy);
  }
  /* The start, within ±DELTA of `ideal`, that best continues `target`.
   * Ties (silence) keep the ideal spot. */
  function best(x, target, ideal) {
    var lo = ideal - DELTA, hi = ideal + DELTA;
    var pick = ideal, top = score(x, target, ideal), c, s;
    for (c = lo; c <= hi; c += 4) { s = score(x, target, c); if (s > top) { top = s; pick = c; } }
    var from = Math.max(lo, pick - 3), to = Math.min(hi, pick + 3);
    for (c = from; c <= to; c++) { s = score(x, target, c); if (s > top) { top = s; pick = c; } }
    return pick;
  }

  /* Where the window written at output sample `out` should read the input:
   * its centre, out + HALF, comes from input sample (out + HALF) * speed. */
  function ideal(out, speed) { return Math.round((out + HALF) * speed) - HALF; }

  /* The work, cut so it can run in slices: run(frames) does up to that many
   * windows and says whether the whole output is written. */
  function job(input, speed) {
    var len = input.length, outLen = Math.ceil(len / speed);
    var out = new Float32Array(outLen + N), previous = 0, k = 0;
    function run(frames) {
      for (var stop = k + frames; k < stop; k++) {
        // The first window starts half a window early so the song's first
        // samples get full weight like every other sample.
        var start = k * HOP - HALF; // output sample of this window's first sample
        if (start >= outLen) return true;
        var wanted = ideal(start, speed);
        var pos = k === 0 ? wanted : best(input, previous + HOP, wanted);
        for (var i = 0; i < N; i++) {
          var o = start + i, j = pos + i;
          if (o >= 0 && j >= 0 && j < len) out[o] += input[j] * WINDOW[i];
        }
        previous = pos;
      }
      return k * HOP - HALF >= outLen;
    }
    return { run: run, result: function () { return out.subarray(0, outLen); } };
  }

  /* input: Float32Array of samples. speed: 0 < speed <= 1.
   * Returns exactly ceil(input.length / speed) samples. */
  function stretch(input, speed) {
    if (!(speed > 0) || speed >= 1) return input;
    var work = job(input, speed);
    work.run(Infinity);
    return work.result();
  }

  /* The same result, computed in slices of about `sliceMs` with the page
   * free to run between them: the clock, the guide bass, the loop and the
   * picture keep going while a slower copy is prepared. Resolves to null as
   * soon as `stale()` says the result is no longer wanted. */
  function stretchAsync(input, speed, stale, sliceMs) {
    if (!(speed > 0) || speed >= 1) return Promise.resolve(input);
    var work = job(input, speed), budget = sliceMs || 12, batch = 16;
    var now = (root.performance && root.performance.now) ? function () { return root.performance.now(); } : Date.now;
    return new Promise(function (resolve, reject) {
      function slice() {
        try {
          if (stale && stale()) { resolve(null); return; }
          var began = now();
          while (now() - began < budget) if (work.run(batch)) { resolve(work.result()); return; }
          root.setTimeout(slice, 0);
        } catch (error) { reject(error); }
      }
      root.setTimeout(slice, 0);
    });
  }

  var api = { stretch: stretch, stretchAsync: stretchAsync, ideal: ideal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprStretch = api;
})(typeof window !== "undefined" ? window : globalThis);
