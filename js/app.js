/* UI glue: song list, modes, transport, and the falling-notes picture. */
(function () {
  "use strict";
  var Midi = window.TprMidi, Layout = window.TprLayout, Fret = window.TprFretboard, Source = window.TprSource, Stretch = window.TprStretch;
  var PREFS_KEY = "tpr_prefs_v1";
  var COLORS = { white: "#35d0c3", black: "#b48cff", folded: "#e0a030" };

  function $(id) { return document.getElementById(id); }

  var prefs = Object.assign({
    latencyMs: 0, speedPct: 100, view: "keys", strings: 4, guide: true, guideVolume: 0.8, mixVolume: 0.9, look: 3, mode: "backing", song: null, shift: {}
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
   * computed on the device, once per song, mode and speed, in slices: until
   * the copy is ready the song plays on at the previous speed, guide bass,
   * loop and picture included, and then switches at the same song time. */
  var PREPARING = "Preparing the slower recording…", preparing = null; // { source, speed, done }
  function preparedFor(source, speed) {
    if (preparing && preparing.source === source && preparing.speed === speed) return preparing.done;
    var job = { source: source, speed: speed };
    job.done = Stretch.stretchAsync(mono(source), speed, function () { return source !== original || speed !== speedOf(); })
      .then(function (samples) {
        if (samples) stretched = { source: source, speed: speed, buffer: engine.makeBuffer(samples, source.sampleRate) };
      })
      .finally(function () { if (preparing === job) preparing = null; });
    preparing = job;
    return job.done;
  }
  async function applySpeed() {
    var speed = speedOf(), source = original, offset = song ? (song.offsetMs || 0) / 1000 : 0;
    var ready = function () { return stretched && stretched.source === source && stretched.speed === speed; };
    if (source && speed !== 1 && !ready()) {
      status(PREPARING);
      await preparedFor(source, speed);
      // Superseded (other speed, mode or song): whoever changed it applies its own.
      if (source !== original || speed !== speedOf() || !ready()) {
        if (!preparing && $("status").textContent === PREPARING) status("");
        return;
      }
    }
    if ($("status").textContent === PREPARING) status("");
    engine.setBuffer(speed === 1 || !source ? source : stretched.buffer, offset, speed);
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
  var spots = [], frets = 12; // bass view: where each note is played, frets drawn
  function placeNotes() {
    if (!parsed) return;
    low = Math.max(Layout.FIRST, Math.min(100, Layout.pickLow(parsed.notes) - 12 * shiftOf()));
    if (prefs.view === "bass") {
      var shift = 12 * shiftOf();
      spots = Fret.finger(parsed.notes.map(function (n) { return { midi: n.midi + shift, start: n.start }; }), prefs.strings);
      frets = Fret.shownFrets(spots);
    }
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
    function syncView() {
      $("view-keys").setAttribute("aria-pressed", String(prefs.view !== "bass"));
      $("view-bass").setAttribute("aria-pressed", String(prefs.view === "bass"));
      $("strings-4").setAttribute("aria-pressed", String(prefs.strings !== 5));
      $("strings-5").setAttribute("aria-pressed", String(prefs.strings === 5));
      $("strings-row").hidden = prefs.view !== "bass";
      canvas.setAttribute("aria-label", prefs.view === "bass" ? "Bass neck with the notes to play" : "Keyboard with the notes to play");
    }
    function setView(view, strings) {
      prefs.view = view; if (strings) prefs.strings = strings;
      savePrefs(); syncView(); placeNotes();
    }
    $("view-keys").addEventListener("click", function () { setView("keys"); });
    $("view-bass").addEventListener("click", function () { setView("bass"); });
    $("strings-4").addEventListener("click", function () { setView("bass", 4); });
    $("strings-5").addEventListener("click", function () { setView("bass", 5); });
    syncView();
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
    var nav = typeof navigator !== "undefined" ? navigator : {};
    // iPhone and iPad: Safari has no install prompt and no full screen for pages.
    if (/iPhone|iPad|iPod/.test(nav.userAgent || "") || (/Macintosh/.test(nav.userAgent || "") && nav.maxTouchPoints > 1)) {
      $("install-legend").textContent = "Keep it on this device";
      $("install-message").textContent = "In Safari, tap Share (the square with an arrow) → Add to Home Screen. The icon then opens without browser bars.";
      $("fullscreen").hidden = true;
    }
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
    if (prefs.view === "bass") { drawBass(); return; }
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

    showTime();
  }
  function showTime() {
    if (!seeking) $("seek").value = String(engine.position());
    $("time").textContent = clock(engine.position()) + " / " + clock(engine.duration());
  }

  /* Bass view: one column per fret (the first for open strings), notes fall
   * into their fret's column in their string's colour, with the fret number
   * on them; the neck below lights the string and fret to press. */
  var STRING_COLORS = { B: "#8fa3b8", E: "#b48cff", A: "#35d0c3", D: "#f0b545", G: "#ff7aa8" };
  function drawBass() {
    var neckHeight = Math.min(Math.max(height * 0.36, 152), height * 0.48, 280), fall = height - neckHeight;
    var t = engine.isPlaying() ? engine.visualPosition(prefs.latencyMs / 1000) : engine.position();
    var look = prefs.look * engine.speed(), scale = fall / look;
    var col = width / (frets + 1), names = Fret.stringNames(prefs.strings), count = names.length;
    var numbers = Math.min(22, neckHeight * 0.14), top = fall + 6, bottom = height - numbers - 4;
    var gapY = (bottom - top) / count;
    function cx(fret) { return (fret + 0.5) * col; }
    // low string at the top, as the player sees the neck looking down at it
    function sy(string) { return top + gapY * (count - 1 - string + 0.5); }
    var lit = {};

    // lanes: a faint line per fret, stronger at the nut
    for (var f = 1; f <= frets; f++) {
      g.fillStyle = f === 1 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
      g.fillRect(f * col - 1, 0, f === 1 ? 3 : 1, fall);
    }
    if (parsed) {
      parsed.beats.forEach(function (beat) {
        if (beat.time < t || beat.time > t + look) return;
        var y = fall - (beat.time - t) * scale;
        g.fillStyle = beat.bar ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)";
        g.fillRect(0, y, width, beat.bar ? 2 : 1);
      });
      var font = Math.round(Math.min(col * 0.42, 22));
      g.textAlign = "center"; g.textBaseline = "middle";
      for (var i = 0; i < parsed.notes.length; i++) {
        var note = parsed.notes[i], spot = spots[i];
        if (note.start > t + look) break;
        if (note.end <= t || !spot) continue;
        var color = STRING_COLORS[names[spot.string]];
        var y1 = Math.min(fall, fall - (note.start - t) * scale);
        var y0 = Math.max(-10, fall - (note.end - t) * scale) + 4;
        if (y1 - y0 < 6) y0 = y1 - 6; // true length: stretching short notes would overlap the next one
        var w = col * 0.74, x = cx(spot.fret) - w / 2;
        g.fillStyle = color;
        rounded(x, y0, w, y1 - y0, 8);
        g.fill();
        if (spot.folded) { g.setLineDash([5, 4]); g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.stroke(); g.setLineDash([]); }
        var size = Math.min(font, y1 - y0 - 4); // too short for a number: the neck shows it on arrival
        if (size >= 10) {
          g.fillStyle = "#0b0f13"; g.font = "700 " + Math.round(size) + "px system-ui, sans-serif";
          g.fillText(String(spot.fret), cx(spot.fret), y1 - size / 2 - 2);
        }
        if (note.start <= t) lit[spot.string] = { fret: spot.fret, color: color, level: 0.78 + 0.22 * Math.exp(-(t - note.start) / 0.12) };
      }
    }

    // hit line
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(0, fall - 2, width, 2);

    // neck: wood, inlays, frets, nut, strings
    g.fillStyle = "#2b2119";
    g.fillRect(col, fall, width - col, bottom - fall + 4);
    g.fillStyle = "#1a1612";
    g.fillRect(0, fall, col, bottom - fall + 4);
    var mid = (top + bottom) / 2;
    g.fillStyle = "rgba(240,235,225,0.55)";
    [3, 5, 7, 9, 15, 17, 19].forEach(function (f) {
      if (f > frets) return;
      g.beginPath(); g.arc(cx(f), mid, Math.min(col, gapY) * 0.14, 0, Math.PI * 2); g.fill();
    });
    if (frets >= 12) [mid - gapY, mid + gapY].forEach(function (y) {
      g.beginPath(); g.arc(cx(12), y, Math.min(col, gapY) * 0.14, 0, Math.PI * 2); g.fill();
    });
    for (f = 1; f <= frets; f++) {
      g.fillStyle = f === 1 ? "#e9e4d8" : "#9aa3ad";
      g.fillRect(f * col - (f === 1 ? 3 : 1), fall, f === 1 ? 6 : 2, bottom - fall + 4);
    }
    for (var s = 0; s < count; s++) {
      var y = sy(s), thick = 1.5 + (count - s) * 0.6; // low strings are thicker
      g.fillStyle = "#d8dde3";
      g.fillRect(col * 0.55, y - thick / 2, width - col * 0.55, thick);
      // string name in its colour, in the open-string column
      g.fillStyle = STRING_COLORS[names[s]];
      g.font = "700 " + Math.round(Math.min(gapY * 0.55, col * 0.4, 22)) + "px system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(names[s], col * 0.28, y);
      var on = lit[s];
      if (on) {
        var r = Math.min(col, gapY) * 0.44;
        g.globalAlpha = on.level; g.fillStyle = on.color;
        if (on.fret === 0) g.fillRect(col, y - 3, width - col, 6); // open string: the whole string lights
        g.beginPath(); g.arc(cx(on.fret), y, r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = "#0b0f13"; g.font = "700 " + Math.round(r * 1.1) + "px system-ui, sans-serif";
        g.fillText(String(on.fret), cx(on.fret), y + 1);
      }
    }
    // fret numbers under the neck
    g.fillStyle = "#b5c0cd"; g.font = "600 " + Math.round(numbers * 0.75) + "px system-ui, sans-serif";
    for (f = 0; f <= frets; f++) if (f === 0 || [3, 5, 7, 9, 12, 15, 17, 19].indexOf(f) >= 0) g.fillText(String(f), cx(f), bottom + 4 + numbers / 2);
    showTime();
  }

  /* ---------- start ---------- */
  function start() {
    var found = Source.extractCode(location.href), linkError = null;
    var asked = (/[#?&]v=(bass|keys)(?:&|$)/.exec(location.href || "") || [])[1];
    if (asked) { prefs.view = asked; savePrefs(); } // a link can open straight on the bass neck
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
