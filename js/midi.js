/* Standard MIDI File parser: bytes in, notes in seconds out. No dependency. */
(function (root) {
  "use strict";

  /* options.bpm: tempo to use when the file states none (some DAWs export
   * the notes without it, and the MIDI default of 120 is then wrong). */
  function parse(input, options) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 0;

    function need(n) { if (pos + n > bytes.length) throw new Error("MIDI file is truncated."); }
    function tag() { need(4); var s = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4; return s; }
    function u32() { need(4); var v = view.getUint32(pos); pos += 4; return v; }
    function u16() { need(2); var v = view.getUint16(pos); pos += 2; return v; }
    function u8() { need(1); return bytes[pos++]; }
    function varlen() {
      var v = 0, b;
      do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80);
      return v >>> 0;
    }

    if (tag() !== "MThd") throw new Error("Not a MIDI file.");
    var headerLength = u32(), headerEnd = pos + headerLength;
    u16(); // format: 0 and 1 are read the same way
    var trackCount = u16(), division = u16();
    if (division & 0x8000) throw new Error("SMPTE-timed MIDI is not supported; export with tempo-based timing.");
    if (!division) throw new Error("MIDI file has no time division.");
    pos = headerEnd;

    var tempos = [], raw = [], tracks = [], signature = null, lastTick = 0;

    while (pos + 8 <= bytes.length && tracks.length < trackCount) {
      var id = tag(), length = u32(), end = pos + length;
      if (end > bytes.length) throw new Error("MIDI file is truncated.");
      if (id !== "MTrk") { pos = end; continue; }
      var index = tracks.length, tick = 0, status = 0, open = {}, name = "", count = 0;
      while (pos < end) {
        tick += varlen();
        var first = u8();
        if (first === 0xff) {
          var type = u8(), metaLength = varlen();
          need(metaLength);
          if (type === 0x51 && metaLength === 3) {
            tempos.push({ tick: tick, us: (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2] });
          } else if (type === 0x58 && metaLength >= 2 && !signature) {
            signature = { numerator: bytes[pos] || 4, denominator: Math.pow(2, bytes[pos + 1]) };
          } else if (type === 0x03 && !name) {
            name = new TextDecoder().decode(bytes.subarray(pos, pos + metaLength));
          }
          pos += metaLength;
          continue;
        }
        if (first === 0xf0 || first === 0xf7) { var skip = varlen(); need(skip); pos += skip; continue; }
        var data1;
        if (first & 0x80) { status = first; data1 = u8(); }
        else { if (!status) throw new Error("MIDI track is corrupt."); data1 = first; }
        var kind = status & 0xf0, channel = status & 0x0f;
        var data2 = (kind === 0xc0 || kind === 0xd0) ? 0 : u8();
        if (kind !== 0x90 && kind !== 0x80) continue;
        var key = channel * 128 + data1;
        if (kind === 0x90 && data2 > 0) {
          (open[key] = open[key] || []).push({ tick: tick, velocity: data2 });
        } else if (open[key] && open[key].length) {
          var on = open[key].shift();
          raw.push({ midi: data1, on: on.tick, off: tick, velocity: on.velocity, track: index, channel: channel });
          count++;
        }
      }
      // A note left hanging ends with its track.
      Object.keys(open).forEach(function (k) {
        open[k].forEach(function (on) {
          raw.push({ midi: k % 128, on: on.tick, off: tick, velocity: on.velocity, track: index, channel: (k / 128) | 0 });
          count++;
        });
      });
      if (tick > lastTick) lastTick = tick;
      tracks.push({ index: index, name: name, notes: count });
      pos = end;
    }

    // Tempo map: segments of constant tempo, each knowing its start in seconds.
    tempos.sort(function (a, b) { return a.tick - b.tick; });
    var fallback = options && options.bpm > 0 ? 6e7 / options.bpm : 500000;
    var map = [{ tick: 0, seconds: 0, us: fallback }];
    tempos.forEach(function (t) {
      var last = map[map.length - 1];
      if (t.tick === last.tick) { last.us = t.us; return; }
      map.push({ tick: t.tick, seconds: last.seconds + (t.tick - last.tick) * last.us / division / 1e6, us: t.us });
    });
    function seconds(tick) {
      var lo = 0, hi = map.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (map[mid].tick <= tick) lo = mid; else hi = mid - 1; }
      return map[lo].seconds + (tick - map[lo].tick) * map[lo].us / division / 1e6;
    }

    var notes = raw.map(function (n) {
      return { midi: n.midi, start: seconds(n.on), end: seconds(Math.max(n.off, n.on + 1)), velocity: n.velocity, track: n.track, channel: n.channel };
    }).sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });

    signature = signature || { numerator: 4, denominator: 4 };
    var beatTicks = division * 4 / signature.denominator, beats = [];
    for (var b = 0; b * beatTicks <= lastTick + beatTicks && beats.length < 20000; b++) {
      beats.push({ time: seconds(b * beatTicks), bar: b % signature.numerator === 0 });
    }

    return {
      notes: notes, beats: beats, tracks: tracks,
      duration: notes.reduce(function (m, n) { return Math.max(m, n.end); }, 0),
      bpm: Math.round(6e7 / map[0].us * 10) / 10,
      hasTempo: tempos.length > 0
    };
  }

  var api = { parse: parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprMidi = api;
})(typeof window !== "undefined" ? window : globalThis);
