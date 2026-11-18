/* UI glue: song list, modes, transport, and the falling-notes picture. */
(function () {
  "use strict";
  var Midi = window.TprMidi, Layout = window.TprLayout, Source = window.TprSource, Stretch = window.TprStretch;
  var PREFS_KEY = "tpr_prefs_v1";
  var COLORS = { white: "#35d0c3", black: "#b48cff", folded: "#e0a030" };

  function $(id) { return document.getElementById(id); }

  var prefs = Object.assign({
    latencyMs: 0, speedPct: 100, guide: true, guideVolume: 0.8, mixVolume: 0.9, look: 3, mode: "backing", song: null, shift: {}
  }, (function () { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (_) { return {}; } })());
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ } }

  var engine = window.TprEngine.create({ onEnd: function () { releaseWake(); syncTransport(); } });
  var config = null, files = {}, songs = [], song = null, parsed = null, low = 28, mode = "silent";
  var loadId = 0, loopA = null, wake = null, seeking = false;
  var original = null, stretched = null, speedTimer = null; // decoded recording, and its slowed copy

  /* ---------- status ---------- */
  function status(text, isError) {
    var el = $("status");
    el.hidden = !text; el.textContent = text || "";
    el.classList.toggle("error", !!isError);
  }
  function clock(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  /* ---------- songs ---------- */
  function demoSong() {
    var beat = 0.6, notes = [], beats = [];
    var pattern = [[0, 1, 0], [1, 0.5, 0], [1.5, 0.5, 12], [2, 1, 7], [3, 0.5, 10], [3.5, 0.5, 12]];
    [28, 28, 31, 33, 28, 28, 35, 33].forEach(function (rootNote, bar) {
      var t0 = (bar + 1) * 4 * beat;
      pattern.forEach(function (p) {
        notes.push({ midi: rootNote + p[2], start: t0 + p[0] * beat, end: t0 + (p[0] + p[1]) * beat - 0.03, velocity: 100 });
      });
    });
    for (var i = 0; i <= 36; i++) beats.push({ time: i * beat, bar: i % 4 === 0 });
    return { notes: notes, beats: beats, duration: 36 * beat };
  }
  var DEMO = { id: "demo", title: "Demo (guide bass only)", demo: true };

  function has(item, kind) {
    if (item.demo) return false;
    return item.local ? !!item.local[kind] : !!item[kind];
  }
  function bytes(item, kind) {
    if (item.local) return item.local[kind].arrayBuffer();
    return Source.file(config, files, item[kind]);
  }

  function fillSongs() {
    var select = $("song");
    select.textContent = "";
    songs.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.artist ? item.title + " — " + item.artist : item.title;
      select.appendChild(option);
    });
    if (song) select.value = song.id;
  }

  async function loadLibrary() {
    status("Loading songs…");
    try {
      var tree = await Source.tree(config);
      files = tree.files;
      var text = new TextDecoder().decode(await Source.file(config, files, "songs.json"));
      songs = Source.readManifest(text);
      if (!songs.length) throw new Error("songs.json lists no song yet.");
      if (!tree.offline) Source.prune(files).catch(function () { /* cache cleanup is best effort */ });
      fillSongs();
      await openSong(songs.filter(function (s) { return s.id === prefs.song; })[0] || songs[0]);
    } catch (error) {
      songs = [DEMO]; fillSongs();
      await openSong(DEMO);
      status(error.message, true);
    }
  }

  async function openSong(item) {
    var id = ++loadId;
    engine.pause(); releaseWake();
    song = item; parsed = null; loopA = null;
    $("song").value = item.id;
    status("Loading " + item.title + "…");
    try {
      var result = item.demo ? demoSong() : Midi.parse(await bytes(item, "midi"), { bpm: item.bpm });
      if (id !== loadId) return;
      var notes = result.notes;
      if (item.track != null) notes = notes.filter(function (n) { return n.track === item.track; });
      if (item.ignoreNotes && item.ignoreNotes.length) notes = notes.filter(function (n) { return item.ignoreNotes.indexOf(n.midi) < 0; });
      if (!notes.length) throw new Error("No notes found in the MIDI file of " + item.title + ".");
      var shift = (item.midiOffsetMs || 0) / 1000;
      if (shift) {
        notes = notes.map(function (n) { return Object.assign({}, n, { start: n.start + shift, end: n.end + shift }); });
        result.beats = result.beats.map(function (b) { return { time: b.time + shift, bar: b.bar }; });
      }
      parsed = { notes: notes, beats: result.beats, duration: notes.reduce(function (m, n) { return Math.max(m, n.end); }, 0) };
      engine.setSong(parsed);
      original = null; engine.setBuffer(null, 0, speedOf());
      placeNotes();
      if (!item.demo && !item.local) { prefs.song = item.id; savePrefs(); }
      var wanted = [prefs.mode, "backing", "full"].filter(function (m) { return m === "silent" || has(item, m); })[0] || "silent";
      await setMode(wanted, true);
      if (id === loadId) status("");
    } catch (error) {
      if (id === loadId) status(error.message, true);
    }
    syncTransport();
  }

  async function setMode(next, keepPreference) {
    if (!song) return;
    var id = loadId;
    if (next !== "silent" && !has(song, next)) next = "silent";
    mode = next;
    if (!keepPreference) { prefs.mode = next; savePrefs(); }
    syncModes();
    if (next === "silent") { original = null; engine.setBuffer(null, 0, speedOf()); return; }
    status("Loading audio…");
    try {
      var audio = await engine.decode(await bytes(song, next));
      if (id !== loadId || mode !== next) return;
      original = audio;
      status("");
      await applySpeed();
    } catch (error) {
      if (id !== loadId) return;
      mode = "silent"; original = null; engine.setBuffer(null, 0, speedOf()); syncModes();
      status(error.message || "This audio file could not be read.", true);
    }
    syncTransport();
  }

  /* ---------- speed ---------- */
  function speedOf() { return prefs.speedPct / 100; }
  function mono(buffer) {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    var left = buffer.getChannelData(0), right = buffer.getChannelData(1), mixed = new Float32Array(left.length);
    for (var i = 0; i < mixed.length; i++) mixed[i] = (left[i] + right[i]) / 2;
    return mixed;
  }
  /* Give the engine the recording at the chosen speed. Slowed copies are
   * computed on the device, once per song, mode and speed. */
  async function applySpeed() {
    var speed = speedOf(), offset = song ? (song.offsetMs || 0) / 1000 : 0;
    if (!original || speed === 1) { engine.setBuffer(original, offset, speed); return; }
    if (!stretched || stretched.source !== original || stretched.speed !== speed) {
      var source = original;
      status("Preparing the slower recording…");
      await new Promise(function (resolve) { setTimeout(resolve, 30); }); // let the message show
      if (source !== original || speed !== speedOf()) return;
      var samples = Stretch.stretch(mono(source), speed);
      stretched = { source: source, speed: speed, buffer: engine.makeBuffer(samples, source.sampleRate) };
      status("");
    }
    engine.setBuffer(stretched.buffer, offset, speed);
  }
  function changeSpeed(by) {
    prefs.speedPct = Math.max(50, Math.min(100, prefs.speedPct + by));
    savePrefs(); syncSpeed();
    clearTimeout(speedTimer); // several taps in a row compute once
    speedTimer = setTimeout(function () { applySpeed().catch(function (error) { status(error.message, true); }); syncTransport(); }, 350);
  }
  function syncSpeed() {
    $("speed").textContent = prefs.speedPct + "%";
    $("slower").disabled = prefs.speedPct <= 50;
    $("faster").disabled = prefs.speedPct >= 100;
  }

  function shiftOf() { return (song && prefs.shift[song.id]) || 0; }
  function placeNotes() {
    if (!parsed) return;
    low = Math.max(Layout.FIRST, Math.min(100, Layout.pickLow(parsed.notes) - 12 * shiftOf()));
    $("shift-out").textContent = shiftOf() > 0 ? "+" + shiftOf() : String(shiftOf());
  }

  /* ---------- controls ---------- */
  function syncModes() {
    document.querySelectorAll(".modes button").forEach(function (button) {
      var m = button.dataset.mode;
      button.setAttribute("aria-pressed", String(m === mode));
      button.disabled = !song || (m !== "silent" && !has(song, m));
    });
  }
  function syncTransport() {
    $("play").textContent = engine.isPlaying() ? "Pause" : "Play";
    $("seek").max = String(Math.max(1, engine.duration()));
    var loop = engine.getLoop();
    $("loop-a").textContent = loopA != null ? "A " + clock(loopA) : "Set A";
    $("loop-b").textContent = loop ? "B " + clock(loop.b) : "Set B";
    $("loop-b").disabled = loopA == null;
    $("loop-clear").disabled = loopA == null && !loop;
  }

  async function requestWake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", function () { wake = null; }); } }
    catch (_) { /* battery saver refused: the screen may dim */ }
  }
  function releaseWake() { if (wake) { wake.release().catch(function () {}); wake = null; } }

  async function toggle() {
    if (!parsed) return;
    if (engine.isPlaying()) { engine.pause(); releaseWake(); }
    else { await engine.play(); requestWake(); }
    syncTransport();
  }

  function bind() {
    $("song").addEventListener("change", function () {
      var item = songs.filter(function (s) { return s.id === $("song").value; })[0];
      if (item) openSong(item);
    });
    document.querySelectorAll(".modes button").forEach(function (button) {
      button.addEventListener("click", function () { setMode(button.dataset.mode); });
    });
    $("guide").checked = prefs.guide;
    $("guide").addEventListener("change", function () {
      prefs.guide = $("guide").checked; engine.setGuide(prefs.guide); savePrefs();
    });
    $("play").addEventListener("click", toggle);
    $("restart").addEventListener("click", function () { engine.seek(0); });
    $("slower").addEventListener("click", function () { changeSpeed(-10); });
    $("faster").addEventListener("click", function () { changeSpeed(10); });
    syncSpeed();
    $("back").addEventListener("click", function () { engine.seek(engine.position() - 5); });
    $("seek").addEventListener("input", function () { seeking = true; engine.seek(Number($("seek").value)); });
    $("seek").addEventListener("change", function () { seeking = false; });

    $("loop-a").addEventListener("click", function () { loopA = engine.position(); engine.setLoop(null, null); syncTransport(); });
    $("loop-b").addEventListener("click", function () {
      if (loopA == null) return;
      engine.setLoop(loopA, engine.position());
      if (engine.getLoop()) engine.seek(loopA);
      syncTransport();
    });
    $("loop-clear").addEventListener("click", function () { loopA = null; engine.setLoop(null, null); syncTransport(); });

    document.addEventListener("keydown", function (event) {
      if (event.code === "Space" && !$("settings").open && !/^(INPUT|SELECT|BUTTON)$/.test(event.target.tagName)) { event.preventDefault(); toggle(); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && engine.isPlaying()) requestWake();
    });

    bindSettings();
  }

  function bindSettings() {
    function slider(id, key, apply, label) {
      var input = $(id), out = $(id + "-out");
      input.value = String(prefs[key]);
      function show() { if (out) out.textContent = label(prefs[key]); }
      input.addEventListener("input", function () { prefs[key] = Number(input.value); if (apply) apply(prefs[key]); show(); savePrefs(); });
      show(); if (apply) apply(prefs[key]);
    }
    slider("latency", "latencyMs", null, function (v) { return v + " ms"; });
    slider("look", "look", null, function (v) { return v + " s"; });
    slider("mix-volume", "mixVolume", engine.setMixVolume);
    slider("guide-volume", "guideVolume", engine.setGuideVolume);
    engine.setGuide(prefs.guide);

    function openSettings() {
      var saved = Source.readConfig();
      $("src-repo").value = saved ? saved.repo : "";
      $("src-branch").value = saved ? saved.branch : "main";
      $("src-token").value = saved ? saved.token : "";
      $("src-link").hidden = true; $("src-message").textContent = "";
      $("setup").open = false; // setup stays folded away for the player
      $("settings").showModal();
      document.querySelector(".sheet-body").scrollTop = 0;
    }
    $("settings-open").addEventListener("click", openSettings);
    bindInstall(openSettings);
    function moveNotes(by) {
      if (!song) return;
      prefs.shift[song.id] = Math.max(-2, Math.min(2, shiftOf() + by));
      savePrefs(); placeNotes();
    }
    $("shift-down").addEventListener("click", function () { moveNotes(-1); });
    $("shift-up").addEventListener("click", function () { moveNotes(1); });
    document.addEventListener("fullscreenchange", function () {
      $("fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
    });
    $("fullscreen").addEventListener("click", async function () {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else throw new Error("Full screen is unavailable");
      } catch (_) {
        openSettings();
        $("install-message").textContent = "Full screen is unavailable here. Use Chrome’s menu (⋮) → Add to home screen → Install, then open the TinyPiano icon.";
        $("install-help").scrollIntoView({ block: "nearest" });
      }
    });

    $("file-load").addEventListener("click", function () {
      var midi = $("file-midi").files[0];
      if (!midi) { $("src-message").textContent = "Choose at least the bass MIDI file."; return; }
      var item = {
        id: "local", title: midi.name.replace(/\.midi?$/i, "") + " (this device)",
        bpm: Number($("file-bpm").value) || null,
        local: { midi: midi, full: $("file-full").files[0] || null, backing: $("file-backing").files[0] || null }
      };
      songs = songs.filter(function (s) { return s.id !== "local"; }).concat(item);
      fillSongs(); $("settings").close(); openSong(item);
    });

    function typed() {
      return Source.clean({ repo: $("src-repo").value, branch: $("src-branch").value || "main", token: $("src-token").value });
    }
    $("src-save").addEventListener("click", function () {
      try { config = typed(); Source.writeConfig(config); } catch (error) { $("src-message").textContent = error.message; return; }
      $("settings").close(); loadLibrary();
    });
    $("src-copy").addEventListener("click", function () {
      var link;
      try { link = location.origin + location.pathname + "#k=" + Source.encodeLink(typed()); }
      catch (error) { $("src-message").textContent = error.message; return; }
      $("src-link").value = link; $("src-link").hidden = false; $("src-link").select();
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
        function () { $("src-message").textContent = "Link copied. Send it privately."; },
        function () { $("src-message").textContent = "Copy the link above by hand."; });
    });
    $("src-forget").addEventListener("click", function () {
      Source.writeConfig(null); config = null; files = {};
      if (window.caches) caches.delete("tpr-blobs-v1");
      $("src-repo").value = ""; $("src-token").value = "";
      $("src-message").textContent = "Forgotten. Saved songs were removed from this device.";
      songs = [DEMO]; fillSongs(); openSong(DEMO);
    });
  }

  function bindInstall(openSettings) {
    var prompt = null;
    function showInstalled() {
      prompt = null;
      $("install").textContent = "Installed";
      $("install").disabled = true;
      $("install-message").textContent = "Ready on this tablet. Next time, tap the TinyPiano icon on your home screen.";
    }
    if (window.matchMedia("(display-mode: standalone)").matches) showInstalled();
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault(); prompt = event;
    });
    window.addEventListener("appinstalled", showInstalled);
    $("install").addEventListener("click", async function () {
      if (prompt) {
        var request = prompt; prompt = null;
        try {
          await request.prompt();
          var choice = await request.userChoice;
          if (choice.outcome === "accepted") return;
        } catch (_) { /* the menu instructions also work without a prompt */ }
      }
      openSettings();
      $("install-help").scrollIntoView({ block: "nearest" });
    });
  }

  /* ---------- picture ---------- */
  var canvas = $("stage"), g = canvas.getContext("2d"), width = 0, height = 0;
  function resize() {
    var ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
    width = box.width; height = box.height;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function rounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!width) return;
    g.clearRect(0, 0, width, height);
    var keyboardHeight = Math.min(Math.max(height * 0.36, 152), height * 0.48, 280), fall = height - keyboardHeight;
    var t = engine.isPlaying() ? engine.visualPosition(prefs.latencyMs / 1000) : engine.position();
    var look = prefs.look * engine.speed(), scale = fall / look; // same fall speed at any speed: slowed notes grow taller
    var keys = Layout.keys(low, width), byMidi = {};
    keys.forEach(function (k) { byMidi[k.midi] = k; });
    var lit = {};

    if (parsed) {
      // beat grid: a strong line per bar, a faint one per beat
      parsed.beats.forEach(function (beat) {
        if (beat.time < t || beat.time > t + look) return;
        var y = fall - (beat.time - t) * scale;
        g.fillStyle = beat.bar ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)";
        g.fillRect(0, y, width, beat.bar ? 2 : 1);
      });
      // falling notes: the bottom edge reaches the keyboard when the note starts
      for (var i = 0; i < parsed.notes.length; i++) {
        var note = parsed.notes[i];
        if (note.start > t + look) break;
        if (note.end <= t) continue;
        var spot = Layout.place(note.midi, low), key = byMidi[spot.key];
        var color = spot.folded ? COLORS.folded : key.black ? COLORS.black : COLORS.white;
        var bottom = Math.min(fall, fall - (note.start - t) * scale);
        var top = Math.max(-10, fall - (note.end - t) * scale) + 4; // gap keeps repeated notes apart
        if (bottom - top < 6) top = bottom - 6;
        var inset = key.black ? 1 : key.w * 0.14;
        g.fillStyle = color;
        rounded(key.x + inset, top, key.w - inset * 2, bottom - top, 6);
        g.fill();
        if (note.start <= t) {
          // flash on the attack, then hold: a repeated note visibly re-strikes
          lit[spot.key] = { color: color, level: 0.78 + 0.22 * Math.exp(-(t - note.start) / 0.12) };
        }
      }
    }

    // hit line
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(0, fall - 2, width, 2);

    // keyboard: white keys first, black keys on top
    [false, true].forEach(function (black) {
      keys.forEach(function (k) {
        if (k.black !== black) return;
        var h = black ? keyboardHeight * 0.62 : keyboardHeight;
        g.fillStyle = black ? "#16191d" : "#f1f3f5";
        rounded(k.x + 1, fall, k.w - 2, h - 2, black ? 4 : 6);
        g.fill();
        var on = lit[k.midi];
        if (on) {
          g.globalAlpha = on.level; g.fillStyle = on.color;
          rounded(k.x + 1, fall, k.w - 2, h - 2, black ? 4 : 6);
          g.fill(); g.globalAlpha = 1;
        }
      });
    });

    if (!seeking) $("seek").value = String(engine.position());
    $("time").textContent = clock(engine.position()) + " / " + clock(engine.duration());
  }

  /* ---------- start ---------- */
  function start() {
    var found = Source.extractCode(location.href), linkError = null;
    if (found.code) {
      try { Source.writeConfig(Source.decodeLink(found.code)); } catch (error) { linkError = error.message; }
      history.replaceState(null, "", found.cleaned); // keep the token out of the address bar and history
    }
    bind();
    resize();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    requestAnimationFrame(draw);

    config = Source.readConfig();
    if (config && !linkError) loadLibrary();
    else { songs = [DEMO]; fillSongs(); openSong(DEMO).then(function () { if (linkError) status(linkError, true); }); }

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline use is optional */ });
    }
  }
  start();
})();
