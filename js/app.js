/* UI glue: song list, modes, transport, and the falling-notes picture. */
(function () {
  "use strict";
  var Midi = window.TprMidi, Layout = window.TprLayout, Fret = window.TprFretboard, Source = window.TprSource, Stretch = window.TprStretch, Theory = window.TprTheory, I18n = window.TprI18n, t = I18n.t;
  var PREFS_KEY = "tpr_prefs_v1";
  var COLORS = { white: "#35d0c3", black: "#b48cff", folded: "#e0a030", touch: "#6fb6ff" };

  function $(id) { return document.getElementById(id); }

  var prefs = Object.assign({
    latencyMs: 0, speedPct: 100, view: "keys", highway: true, dots: true, guide: true, guideVolume: 0.8, playVolume: 0.8, mixVolume: 0.9, look: 3, mode: "backing", song: null, shift: {}
  }, (function () { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (_) { return {}; } })());
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ } }

  var engine = window.TprEngine.create({ onEnd: function () { releaseWake(); syncTransport(); } });
  var config = null, files = {}, songs = [], song = null, parsed = null, low = 28, mode = "silent", songKey = null;
  var loadId = 0, loopA = null, wake = null, seeking = false;
  var original = null, stretched = null, speedTimer = null; // decoded recording, and its slowed copy

  /* ---------- status ---------- */
  function status(text, isError) {
    var el = $("status");
    el.hidden = !text; el.textContent = t(text) || "";
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
      option.textContent = item.artist ? item.title + " — " + item.artist : item.demo ? t(item.title) : item.title;
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
      if (!tree.offline) saveAll();
      else $("offline-out").textContent = t("No network: playing what is already on this device.");
    } catch (error) {
      songs = [DEMO]; fillSongs();
      await openSong(DEMO);
      status(error.message, true);
    }
  }

  /* Put every song of the library on the device, in the background, so the
   * next rehearsal works with no network at all. */
  var saving = null;
  function saveAll() {
    var out = $("offline-out"), mine = config, list = songs;
    out.textContent = t("Saving songs on this device…");
    saving = Source.preload(config, files, songs, function (state) {
      if (config === mine) out.textContent = t("Saving songs on this device: " + state.done + " of " + state.total + " files…");
    }).then(function (state) {
      if (config !== mine) return;
      out.textContent = t(state.failed
        ? state.done + " of " + state.total + " files saved. The others download when you open their song with a network."
        : "All " + list.length + " songs are saved on this device and play with no network.");
    }, function () { out.textContent = t("Saving songs for offline use failed. Songs you open are still saved."); });
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
      songKey = (item.key && Theory.parse(item.key)) || Theory.detect(notes);
      syncKey();
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
        if (!preparing && $("status").textContent === t(PREPARING)) status("");
        return;
      }
    }
    if ($("status").textContent === t(PREPARING)) status("");
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
      spots = Fret.finger(parsed.notes.map(function (n) { return { midi: n.midi + shift, start: n.start }; }), 4);
      frets = Fret.shownFrets(spots);
    }
    $("shift-out").textContent = shiftOf() > 0 ? "+" + shiftOf() : String(shiftOf());
  }

  function syncKey() {
    $("key-out").textContent = songKey
      ? t("This song is in " + I18n.keyName(songKey) + ". Dots mark the notes that fit it; the ringed dot is " + I18n.tonicName(songKey) + ", the home note.")
      : "";
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
    $("play").textContent = t(engine.isPlaying() ? "Pause" : "Play");
    $("seek").max = String(Math.max(1, engine.duration()));
    var loop = engine.getLoop();
    $("loop-a").textContent = loopA != null ? "A " + clock(loopA) : t("Set A");
    $("loop-b").textContent = loop ? "B " + clock(loop.b) : t("Set B");
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
      function show() { if (out) out.textContent = t(label(prefs[key])); }
      input.addEventListener("input", function () { prefs[key] = Number(input.value); if (apply) apply(prefs[key]); show(); savePrefs(); });
      show(); if (apply) apply(prefs[key]);
    }
    slider("latency", "latencyMs", null, function (v) { return v + " ms"; });
    slider("look", "look", null, function (v) { return v + " s"; });
    slider("mix-volume", "mixVolume", engine.setMixVolume);
    slider("guide-volume", "guideVolume", engine.setGuideVolume);
    slider("play-volume", "playVolume", engine.setPlayVolume);
    engine.setGuide(prefs.guide);

    function openSettings() {
      var saved = Source.readConfig();
      $("src-repo").value = saved ? saved.repo : "";
      $("src-branch").value = saved ? saved.branch : "main";
      $("src-token").value = saved ? saved.token : "";
      $("src-link").hidden = true; $("src-message").textContent = t("");
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
      $("fall-show").setAttribute("aria-pressed", String(prefs.highway !== false));
      $("fall-hide").setAttribute("aria-pressed", String(prefs.highway === false));
      $("look-row").hidden = prefs.highway === false;
      $("dots-show").setAttribute("aria-pressed", String(prefs.dots !== false));
      $("dots-hide").setAttribute("aria-pressed", String(prefs.dots === false));
      canvas.setAttribute("aria-label", t(prefs.view === "bass" ? "Bass neck with the notes to play" : "Keyboard with the notes to play"));
    }
    function setView(view) {
      prefs.view = view;
      savePrefs(); syncView(); placeNotes();
    }
    $("view-keys").addEventListener("click", function () { setView("keys"); });
    $("view-bass").addEventListener("click", function () { setView("bass"); });
    function setHighway(on) { prefs.highway = on; savePrefs(); syncView(); }
    $("fall-show").addEventListener("click", function () { setHighway(true); });
    $("fall-hide").addEventListener("click", function () { setHighway(false); });
    $("lang-en").setAttribute("aria-pressed", String(I18n.lang === "en"));
    $("lang-fr").setAttribute("aria-pressed", String(I18n.lang === "fr"));
    ["en", "fr"].forEach(function (lang) {
      $("lang-" + lang).addEventListener("click", function () { if (lang !== I18n.lang) I18n.choose(lang); });
    });
    function setDots(on) { prefs.dots = on; savePrefs(); syncView(); }
    $("dots-show").addEventListener("click", function () { setDots(true); });
    $("dots-hide").addEventListener("click", function () { setDots(false); });
    syncView();
    document.addEventListener("fullscreenchange", function () {
      $("fullscreen").textContent = t(document.fullscreenElement ? "Exit full screen" : "Full screen");
    });
    $("fullscreen").addEventListener("click", async function () {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else throw new Error("Full screen is unavailable");
      } catch (_) {
        openSettings();
        $("install-message").textContent = t("Full screen is unavailable here. Use Chrome’s menu (⋮) → Add to home screen → Install, then open the TinyPiano icon.");
        $("install-help").scrollIntoView({ block: "nearest" });
      }
    });

    $("file-load").addEventListener("click", function () {
      var midi = $("file-midi").files[0];
      if (!midi) { $("src-message").textContent = t("Choose at least the bass MIDI file."); return; }
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
      try { config = typed(); Source.writeConfig(config); } catch (error) { $("src-message").textContent = t(error.message); return; }
      $("settings").close(); loadLibrary();
    });
    $("src-copy").addEventListener("click", function () {
      var link;
      try { link = location.origin + location.pathname + "#k=" + Source.encodeLink(typed()); }
      catch (error) { $("src-message").textContent = t(error.message); return; }
      $("src-link").value = link; $("src-link").hidden = false; $("src-link").select();
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
        function () { $("src-message").textContent = t("Link copied. Send it privately."); },
        function () { $("src-message").textContent = t("Copy the link above by hand."); });
    });
    $("src-forget").addEventListener("click", function () {
      Source.writeConfig(null); config = null; files = {}; $("offline-out").textContent = t("");
      if (window.caches) caches.delete("tpr-blobs-v1");
      $("src-repo").value = ""; $("src-token").value = "";
      $("src-message").textContent = t("Forgotten. Saved songs were removed from this device.");
      songs = [DEMO]; fillSongs(); openSong(DEMO);
    });
  }

  function bindInstall(openSettings) {
    var prompt = null;
    var nav = typeof navigator !== "undefined" ? navigator : {};
    // iPhone and iPad: Safari has no install prompt and no full screen for pages.
    if (/iPhone|iPad|iPod/.test(nav.userAgent || "") || (/Macintosh/.test(nav.userAgent || "") && nav.maxTouchPoints > 1)) {
      $("install-legend").textContent = t("Keep it on this device");
      $("install-message").textContent = t("In Safari, tap Share (the square with an arrow) → Add to Home Screen. The icon then opens without browser bars.");
      $("fullscreen").hidden = true;
    }
    function showInstalled() {
      prompt = null;
      $("install").textContent = t("Installed");
      $("install").disabled = true;
      $("install-message").textContent = t("Ready on this tablet. Next time, tap the TinyPiano icon on your home screen.");
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

  /* Where the instrument sits. With falling notes it takes the bottom part
   * of the screen; with lights only it grows and sits in the middle. */
  function stage() {
    if (prefs.highway !== false) {
      var size = Math.min(Math.max(height * 0.36, 152), height * 0.48, 280);
      return { highway: true, size: size, top: height - size };
    }
    var big = Math.min(height - 24, prefs.view === "bass" ? 340 : 360);
    return { highway: false, size: big, top: Math.round((height - big) / 2) };
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!width) return;
    g.clearRect(0, 0, width, height);
    if (prefs.view === "bass") { drawBass(); return; }
    var lay = stage(), keyboardHeight = lay.size, fall = lay.top, showFall = lay.highway;
    var t = engine.isPlaying() ? engine.visualPosition(prefs.latencyMs / 1000) : engine.position();
    var look = prefs.look * engine.speed(), scale = fall / look; // same fall speed at any speed: slowed notes grow taller
    var keys = Layout.keys(low, width), byMidi = {};
    keys.forEach(function (k) { byMidi[k.midi] = k; });
    var lit = {}, next = null, touched = touchedBy("midi");

    if (parsed) {
      // beat grid: a strong line per bar, a faint one per beat
      if (showFall) parsed.beats.forEach(function (beat) {
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
        if (note.start > t && !next) next = { key: key, color: color };
        if (showFall) {
          var bottom = Math.min(fall, fall - (note.start - t) * scale);
          var top = Math.max(-10, fall - (note.end - t) * scale) + 4; // gap keeps repeated notes apart
          if (bottom - top < 6) top = bottom - 6;
          var inset = key.black ? 1 : key.w * 0.14;
          g.fillStyle = color;
          rounded(key.x + inset, top, key.w - inset * 2, bottom - top, 6);
          g.fill();
        }
        if (note.start <= t) {
          // flash on the attack, then hold: a repeated note visibly re-strikes
          lit[spot.key] = { color: color, level: 0.78 + 0.22 * Math.exp(-(t - note.start) / 0.12) };
        }
      }
    }

    // hit line
    if (showFall) { g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(0, fall - 2, width, 2); }
    keyLabel();

    // lights only: outline the next key to press, so the hand can get there.
    // Drawn with its own row of keys, so black keys still cover a white outline.
    function outlineNext(black) {
      if (showFall || !next || lit[next.key.midi] || next.key.black !== black) return;
      var nh = black ? keyboardHeight * 0.62 : keyboardHeight;
      g.strokeStyle = next.color; g.lineWidth = 4; g.setLineDash([8, 6]);
      rounded(next.key.x + 3, fall + 2, next.key.w - 6, nh - 6, 6); g.stroke(); g.setLineDash([]);
    }
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
        if (touched[k.midi]) {
          g.globalAlpha = 0.85; g.fillStyle = COLORS.touch;
          rounded(k.x + 1, fall, k.w - 2, h - 2, black ? 4 : 6);
          g.fill(); g.globalAlpha = 1;
        }
        if (dotsOn() && Theory.inKey(songKey, k.midi)) {
          var r = Math.min(k.w * 0.17, 7);
          dot(k.x + k.w / 2, fall + h - 2 - r * 2.6, r, Theory.isTonic(songKey, k.midi), black ? "rgba(235,240,245,0.85)" : "rgba(40,48,58,0.7)");
        }
      });
      outlineNext(black);
    });

    showTime();
  }
  /* Notes of the song's key: a small dot, the key note a bigger ringed one. */
  function dotsOn() { return prefs.dots !== false && !!songKey; }
  function dot(x, y, r, tonic, color) {
    g.fillStyle = color; g.strokeStyle = color;
    g.beginPath(); g.arc(x, y, tonic ? r * 0.75 : r * 0.6, 0, Math.PI * 2); g.fill();
    if (tonic) { g.lineWidth = Math.max(1.5, r * 0.3); g.beginPath(); g.arc(x, y, r * 1.25, 0, Math.PI * 2); g.stroke(); }
  }
  function keyLabel() {
    if (!dotsOn() || stage().top < 28) return; // lights only: no room above the instrument
    g.fillStyle = "rgba(220,228,236,0.6)"; g.font = "600 14px system-ui, sans-serif";
    g.textAlign = "left"; g.textBaseline = "top";
    g.fillText(t("Key: " + I18n.keyName(songKey) + "  ·  dots = notes that fit"), 10, 8);
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
    var lay = stage(), neckHeight = lay.size, fall = lay.top, showFall = lay.highway;
    var t = engine.isPlaying() ? engine.visualPosition(prefs.latencyMs / 1000) : engine.position();
    var look = prefs.look * engine.speed(), scale = fall / look;
    var n = neck(lay), col = n.col, names = n.names, count = n.count, numbers = n.numbers;
    var top = n.top, bottom = n.bottom, gapY = n.gapY, tuning = Fret.tuning(4), touched = touchedBy("string");
    function cx(fret) { return (fret + 0.5) * col; }
    // low string at the top, as the player sees the neck looking down at it
    function sy(string) { return top + gapY * (count - 1 - string + 0.5); }
    var lit = {}, next = null;

    keyLabel();
    // lanes: a faint line per fret, stronger at the nut
    for (var f = 1; showFall && f <= frets; f++) {
      g.fillStyle = f === 1 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
      g.fillRect(f * col - 1, 0, f === 1 ? 3 : 1, fall);
    }
    if (parsed) {
      if (showFall) parsed.beats.forEach(function (beat) {
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
        if (note.start <= t) lit[spot.string] = { fret: spot.fret, color: color, level: 0.78 + 0.22 * Math.exp(-(t - note.start) / 0.12) };
        else if (!next) next = { string: spot.string, fret: spot.fret, color: color };
        if (!showFall) continue;
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
      }
    }

    // hit line
    if (showFall) { g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(0, fall - 2, width, 2); }

    // neck: wood, inlays, frets, nut, strings
    g.fillStyle = "#2b2119";
    g.fillRect(col, fall, width - col, bottom - fall + 4);
    g.fillStyle = "#1a1612";
    g.fillRect(0, fall, col, bottom - fall + 4);
    var mid = (top + bottom) / 2;
    g.fillStyle = dotsOn() ? "rgba(240,235,225,0.18)" : "rgba(240,235,225,0.55)"; // key dots on: inlays step back
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
      if (dotsOn()) for (f = 0; f <= frets; f++) {
        if (!Theory.inKey(songKey, tuning[s] + f)) continue;
        dot(f === 0 ? col * 0.8 : cx(f), y, Math.min(col, gapY) * 0.2, Theory.isTonic(songKey, tuning[s] + f), "#f4f1ea");
      }
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
      var mine = touched[s];
      if (mine) {
        var tr = Math.min(col, gapY) * 0.44;
        g.globalAlpha = 0.9; g.fillStyle = COLORS.touch;
        g.beginPath(); g.arc(cx(mine.fret), y, tr, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.fillStyle = "#0b0f13"; g.font = "700 " + Math.round(tr * 1.1) + "px system-ui, sans-serif";
        g.textAlign = "center"; g.fillText(String(mine.fret), cx(mine.fret), y + 1);
      }
    }
    // lights only: a dashed ring on the next spot to press
    if (!showFall && next && !(lit[next.string] && lit[next.string].fret === next.fret)) {
      g.strokeStyle = next.color; g.lineWidth = 3; g.setLineDash([6, 5]);
      g.beginPath(); g.arc(cx(next.fret), sy(next.string), Math.min(col, gapY) * 0.42, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // fret numbers under the neck
    g.fillStyle = "#b5c0cd"; g.font = "600 " + Math.round(numbers * 0.75) + "px system-ui, sans-serif";
    for (f = 0; f <= frets; f++) if (f === 0 || [3, 5, 7, 9, 12, 15, 17, 19].indexOf(f) >= 0) g.fillText(String(f), cx(f), bottom + 4 + numbers / 2);
    showTime();
  }

  function neck(lay) {
    var names = Fret.stringNames(4), numbers = Math.min(22, lay.size * 0.14);
    var top = lay.top + 6, bottom = lay.top + lay.size - numbers - 4;
    return { col: width / (frets + 1), names: names, count: names.length, numbers: numbers, top: top, bottom: bottom, gapY: (bottom - top) / names.length };
  }

  /* ---------- playing by touch ---------- */
  /* What a finger at (x, y) presses: a key, or a string at a fret. Black keys
   * win over the white key under them. Above the instrument: nothing. */
  function hitAt(x, y) {
    var lay = stage();
    if (y < lay.top || y > lay.top + lay.size) return null;
    if (prefs.view === "bass") {
      var n = neck(lay), fret = Math.floor(x / n.col);
      if (y > n.bottom + 4 || fret < 0 || fret > frets) return null;
      var row = Math.max(0, Math.min(n.count - 1, Math.floor((y - n.top) / n.gapY)));
      var string = n.count - 1 - row;
      return { midi: Fret.tuning(4)[string] + fret, string: string, fret: fret };
    }
    var keys = Layout.keys(low, width), onBlack = y < lay.top + lay.size * 0.62, i;
    for (i = 0; onBlack && i < keys.length; i++) if (keys[i].black && x >= keys[i].x && x < keys[i].x + keys[i].w) return { midi: keys[i].midi };
    for (i = 0; i < keys.length; i++) if (!keys[i].black && x >= keys[i].x && x < keys[i].x + keys[i].w) return { midi: keys[i].midi };
    return null;
  }
  var held = {}; // pointer id -> { hit, release }
  function touchedBy(field) {
    var out = {};
    Object.keys(held).forEach(function (id) { var hit = held[id].hit; if (hit) out[hit[field]] = hit; });
    return out;
  }
  function pointAt(event) {
    var box = canvas.getBoundingClientRect();
    return hitAt(event.clientX - box.left, event.clientY - box.top);
  }
  function sound(id, hit) {
    var was = held[id];
    if (was && was.hit && hit && was.hit.midi === hit.midi && was.hit.string === hit.string) return;
    if (was && was.release) was.release();
    held[id] = { hit: hit, release: hit ? engine.press(hit.midi) : null };
  }
  function lift(event) {
    var was = held[event.pointerId];
    if (was && was.release) was.release();
    delete held[event.pointerId];
  }
  function bindTouch() {
    canvas.addEventListener("pointerdown", function (event) {
      var hit = pointAt(event);
      if (!hit) return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* old browser: up still arrives on the canvas */ }
      sound(event.pointerId, hit);
    });
    // sliding a finger plays the keys or frets it crosses
    canvas.addEventListener("pointermove", function (event) {
      if (held[event.pointerId]) sound(event.pointerId, pointAt(event));
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) { canvas.addEventListener(name, lift); });
    canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  }

  /* ---------- start ---------- */
  function start() {
    I18n.page(document);
    var found = Source.extractCode(location.href), linkError = null;
    var asked = (/[#?&]v=(bass|keys)(?:&|$)/.exec(location.href || "") || [])[1];
    if (asked) { prefs.view = asked; savePrefs(); } // a link can open straight on the bass neck
    if (found.code) {
      try { Source.writeConfig(Source.decodeLink(found.code)); } catch (error) { linkError = error.message; }
      history.replaceState(null, "", found.cleaned); // keep the token out of the address bar and history
    }
    bind();
    bindTouch();
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
