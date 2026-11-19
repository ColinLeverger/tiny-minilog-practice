/* Transport: one Web Audio clock drives the backing track, the guide bass and
 * the picture, so the three cannot drift apart. */
(function (root) {
  "use strict";

  /* Index of the first note that is still to be heard at `position`. */
  function firstAudible(notes, position) {
    var i = 0;
    while (i < notes.length && notes[i].end <= position) i++;
    return i;
  }
  function frequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function create(options) {
    options = options || {};
    var ctx = null, mixGain, guideGain, playGain, limiter;
    var notes = [], midiDuration = 0, buffer = null, bufferOffset = 0;
    var playing = false, startCtx = 0, startPos = 0, cursor = 0, timer = null;
    var source = null, voices = [], loop = null;
    var guideOn = true, guideVolume = 0.8, mixVolume = 0.9, playVolume = 0.8;
    var speed = 1; // song seconds per real second

    function context() {
      if (ctx) return ctx;
      var Ctor = root.AudioContext || root.webkitAudioContext;
      ctx = new Ctor({ latencyHint: "interactive" });
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.1;
      limiter.connect(ctx.destination);
      mixGain = ctx.createGain(); mixGain.gain.value = mixVolume; mixGain.connect(limiter);
      guideGain = ctx.createGain(); guideGain.gain.value = guideOn ? guideVolume : 0; guideGain.connect(limiter);
      playGain = ctx.createGain(); playGain.gain.value = playVolume; playGain.connect(limiter);
      return ctx;
    }

    /* iOS plays Web Audio as "ambient" sound, which the ring/silent switch
     * mutes. Declaring a playback session lifts that; on older iOS a looping
     * silent <audio> element started in the same tap has the same effect. */
    var keepAlive = null;
    function unmute() {
      try {
        if (root.navigator && root.navigator.audioSession) { root.navigator.audioSession.type = "playback"; return; }
      } catch (_) { /* fall through to the element */ }
      if (!root.Audio || !root.Blob || !root.URL) return;
      if (!keepAlive) {
        var rate = 8000, bytes = new Uint8Array(44 + rate / 2), view = new DataView(bytes.buffer);
        [0x52494646, 36 + rate / 2, 0x57415645, 0x666d7420].forEach(function (v, i) { view.setUint32(i * 4, v, i === 1); });
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
        view.setUint32(36, 0x64617461); view.setUint32(40, rate / 2, true);
        bytes.fill(128, 44); // 8-bit silence
        keepAlive = new root.Audio(root.URL.createObjectURL(new root.Blob([bytes], { type: "audio/wav" })));
        keepAlive.loop = true; keepAlive.setAttribute("playsinline", "");
      }
      var started = keepAlive.play();
      if (started && started.catch) started.catch(function () { /* sound may stay muted by the switch */ });
    }

    function duration() {
      var audio = buffer ? buffer.duration * speed - bufferOffset : 0;
      return Math.max(midiDuration, audio, 0);
    }
    function position() {
      if (!playing) return startPos;
      return startPos + (ctx.currentTime - startCtx) * speed;
    }
    function outputLatency() {
      if (!ctx) return 0;
      return ctx.outputLatency || ctx.baseLatency || 0;
    }

    /* A sub you can also hear on a tablet speaker: the sine carries the real
     * low end for headphones, the filtered saw and the octave add the
     * harmonics a small speaker can reproduce. */
    function voice(note, when, length) {
      when = Math.max(when, ctx.currentTime); // rounding must never ask for a time in the past
      var f = frequency(note.midi), peak = 0.35 + 0.45 * (note.velocity / 127);
      var end = when + Math.max(length, 0.05);
      var env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(peak, when + 0.008);
      env.gain.setValueAtTime(peak, Math.max(when + 0.009, end - 0.015));
      env.gain.linearRampToValueAtTime(0, end + 0.04);
      env.connect(guideGain);

      var oscillators = [];
      function osc(type, freq, gain, filter) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq; g.gain.value = gain;
        if (filter) { o.connect(filter); filter.connect(g); } else o.connect(g);
        g.connect(env); o.start(when); o.stop(end + 0.06);
        oscillators.push(o);
      }
      var lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass"; lowpass.frequency.value = 1400; lowpass.Q.value = 0.7;
      osc("sine", f, 0.9);
      osc("sawtooth", f, 0.3, lowpass);
      osc("sine", f * 2, 0.22);

      var entry = { env: env, oscillators: oscillators };
      voices.push(entry);
      oscillators[0].onended = function () {
        var i = voices.indexOf(entry);
        if (i >= 0) voices.splice(i, 1);
        env.disconnect();
      };
    }
    /* A note the player holds with a finger: same sound as the guide bass,
     * sustained until release() is called. Its own volume, and it sounds
     * whether the guide bass is on or off. */
    function press(midi) {
      context();
      unmute();
      if (ctx.state !== "running") ctx.resume();
      var when = ctx.currentTime, f = frequency(midi), peak = 0.6;
      var env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(peak, when + 0.008);
      env.gain.setTargetAtTime(peak * 0.7, when + 0.05, 0.4); // a plucked string fades a little
      env.connect(playGain);
      var lowpass = ctx.createBiquadFilter(), oscillators = [];
      lowpass.type = "lowpass"; lowpass.frequency.value = 1400; lowpass.Q.value = 0.7;
      [["sine", f, 0.9, null], ["sawtooth", f, 0.3, lowpass], ["sine", f * 2, 0.22, null]].forEach(function (p) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = p[0]; o.frequency.value = p[1]; g.gain.value = p[2];
        if (p[3]) { o.connect(p[3]); p[3].connect(g); } else o.connect(g);
        g.connect(env); o.start(when);
        oscillators.push(o);
      });
      var released = false;
      return function release() {
        if (released) return;
        released = true;
        var now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setTargetAtTime(0, now, 0.03);
        oscillators.forEach(function (o) { o.stop(now + 0.25); });
        oscillators[0].onended = function () { env.disconnect(); };
      };
    }

    function silence() {
      var now = ctx.currentTime;
      voices.forEach(function (v) {
        v.env.gain.cancelScheduledValues(now);
        v.env.gain.setTargetAtTime(0, now, 0.01);
        v.oscillators.forEach(function (o) { try { o.stop(now + 0.06); } catch (_) { /* already stopped */ } });
      });
      if (source) { try { source.stop(); } catch (_) { /* never started */ } source.disconnect(); source = null; }
    }

    function schedule() {
      var pos = position(), horizon = pos + 0.3 * speed;
      while (cursor < notes.length && notes[cursor].start < horizon) {
        var note = notes[cursor++];
        // Never before the requested start: on the first pass the clock still
        // reads up to 60 ms earlier, and that would schedule sound in the past.
        var from = Math.max(note.start, pos, startPos);
        if (note.end - from > 0.02) voice(note, startCtx + (from - startPos) / speed, (note.end - from) / speed);
      }
    }
    function tick() {
      if (!playing) return;
      var pos = position();
      if (loop && pos >= loop.b) { seek(loop.a); return; }
      if (pos >= duration() + 0.3) {
        pause(); startPos = 0;
        if (options.onEnd) options.onEnd();
        return;
      }
      schedule();
    }

    function begin() {
      startCtx = ctx.currentTime + 0.06;
      cursor = firstAudible(notes, startPos);
      if (buffer) {
        source = ctx.createBufferSource();
        source.buffer = buffer; source.connect(mixGain);
        var at = (startPos + bufferOffset) / speed; // seconds into the (stretched) buffer
        if (at < 0) source.start(startCtx - at, 0);
        else if (at < buffer.duration) source.start(startCtx, at);
      }
      schedule();
    }

    async function play() {
      context();
      unmute(); // must run inside the tap, before the first await
      if (ctx.state !== "running") await ctx.resume();
      if (playing) return;
      if (startPos >= duration()) startPos = 0;
      playing = true;
      begin();
      timer = root.setInterval(tick, 50);
    }
    function pause() {
      if (!playing) return;
      startPos = Math.max(0, position());
      playing = false;
      root.clearInterval(timer);
      silence();
      if (keepAlive) keepAlive.pause();
    }
    function seek(to) {
      to = Math.max(0, Math.min(to, duration()));
      if (!playing) { startPos = to; return; }
      silence();
      startPos = to;
      begin();
    }

    return {
      play: play, pause: pause, seek: seek, position: position, duration: duration,
      isPlaying: function () { return playing; },
      speed: function () { return speed; },
      /* What the eye should see now: the sound leaving the speaker left the
       * clock `latency` ago. */
      visualPosition: function (extraSeconds) { return position() - (outputLatency() + (extraSeconds || 0)) * speed; },
      decode: function (arrayBuffer) { return context().decodeAudioData(arrayBuffer); },
      makeBuffer: function (samples, sampleRate) {
        var made = context().createBuffer(1, samples.length, sampleRate);
        made.copyToChannel(samples, 0);
        return made;
      },
      setSong: function (song) { pause(); notes = song.notes; midiDuration = song.duration; startPos = 0; loop = null; },
      /* Swap the audio track and the speed in place, keeping the position.
       * `next` must already be stretched for `nextSpeed`. */
      setBuffer: function (next, offsetSeconds, nextSpeed) {
        var at = position(), was = playing;
        if (was) { silence(); }
        buffer = next || null; bufferOffset = offsetSeconds || 0; speed = nextSpeed || 1;
        if (was) { startPos = Math.max(0, at); begin(); }
      },
      setGuide: function (on) {
        guideOn = !!on;
        if (ctx) guideGain.gain.setTargetAtTime(guideOn ? guideVolume : 0, ctx.currentTime, 0.02);
      },
      setGuideVolume: function (v) {
        guideVolume = v;
        if (ctx && guideOn) guideGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      },
      press: press,
      setPlayVolume: function (v) {
        playVolume = v;
        if (ctx) playGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      },
      setMixVolume: function (v) {
        mixVolume = v;
        if (ctx) mixGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
      },
      setLoop: function (a, b) { loop = (a != null && b != null && b - a > 0.2) ? { a: a, b: b } : null; },
      getLoop: function () { return loop; }
    };
  }

  var api = { create: create, firstAudible: firstAudible, frequency: frequency };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
