/* Read-only access to the private data repository through the GitHub API.
 * The repository, branch and token travel in one link code, so the person who
 * receives the link configures nothing. */
(function (root) {
  "use strict";
  var KEY = "tpr_source_v1", TREE_KEY = "tpr_tree_v1", CACHE = "tpr-blobs-v1";

  function validate(config) {
    if (!config || !/^[\w.-]+\/[\w.-]+$/.test(config.repo || "")) throw new Error("Use owner/repository for the repository name.");
    if (!/^\S+$/.test(config.token || "")) throw new Error("A fine-grained GitHub token is required.");
    if (!/^[\w./-]+$/.test(config.branch || "")) throw new Error("A branch is required.");
    return config;
  }
  function clean(config) {
    return validate({
      repo: String(config.repo || "").trim(),
      branch: String(config.branch || "main").trim(),
      token: String(config.token || "").trim()
    });
  }

  function toBase64Url(text) {
    var bytes = new TextEncoder().encode(text), binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(code) {
    code = String(code || "").replace(/-/g, "+").replace(/_/g, "/");
    while (code.length % 4) code += "=";
    var binary = atob(code), bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeLink(config) {
    config = clean(config);
    return toBase64Url(JSON.stringify({ r: config.repo, b: config.branch, t: config.token }));
  }
  function decodeLink(code) {
    var shared;
    try { shared = JSON.parse(fromBase64Url(code)); } catch (_) { throw new Error("This link is damaged. Ask for a new one."); }
    return clean({ repo: shared.r, branch: shared.b, token: shared.t });
  }

  /* Find a link code in a URL. The fragment (#k=) is what the app produces,
   * because a fragment is never sent to a server; ?k= is accepted too.
   * Returns the code and the same URL with the code removed. */
  function extractCode(href) {
    var url = new URL(href), code = null;
    var hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (hash.has("k")) { code = hash.get("k"); hash.delete("k"); url.hash = hash.toString(); }
    if (url.searchParams.has("k")) { code = code || url.searchParams.get("k"); url.searchParams.delete("k"); }
    return { code: code, cleaned: url.toString() };
  }

  function readConfig() {
    try { return clean(JSON.parse(root.localStorage.getItem(KEY))); } catch (_) { return null; }
  }
  function writeConfig(config) {
    if (config) root.localStorage.setItem(KEY, JSON.stringify(clean(config)));
    else { root.localStorage.removeItem(KEY); root.localStorage.removeItem(TREE_KEY); }
  }

  function safePath(path) {
    path = String(path || "").replace(/^\/+/, "");
    if (!path || /(^|\/)\.\.?($|\/)/.test(path)) throw new Error("Unsafe file path in the song list: " + path);
    return path;
  }
  function headers(config, accept) {
    return { Accept: accept, Authorization: "Bearer " + config.token, "X-GitHub-Api-Version": "2022-11-28" };
  }
  async function request(config, url, accept) {
    var response;
    try { response = await root.fetch(url, { headers: headers(config, accept), cache: "no-store" }); }
    catch (_) { var offline = new Error("No network."); offline.offline = true; throw offline; }
    if (response.ok) return response;
    var error = new Error(
      response.status === 401 ? "This link has expired or was revoked. Ask for a new one."
        : response.status === 404 ? "Not found in the data repository: " + decodeURIComponent(url.split("/contents/")[1] || url).split("?")[0]
        : response.status === 403 ? "GitHub refused the request (rate limit or permissions). Try again later."
        : "GitHub returned " + response.status + ".");
    error.status = response.status;
    throw error;
  }

  /* path -> blob sha for every file on the branch. One call tells us which
   * cached files are still current. Falls back to the last known tree offline. */
  async function tree(config) {
    try {
      var url = "https://api.github.com/repos/" + config.repo + "/git/trees/" + encodeURIComponent(config.branch) + "?recursive=1";
      var data = await (await request(config, url, "application/vnd.github+json")).json(), map = {};
      (data.tree || []).forEach(function (entry) { if (entry.type === "blob") map[entry.path] = entry.sha; });
      try { root.localStorage.setItem(TREE_KEY, JSON.stringify(map)); } catch (_) { /* quota: stay online-only */ }
      return { files: map, offline: false };
    } catch (error) {
      if (!error.offline) throw error;
      var saved = null;
      try { saved = JSON.parse(root.localStorage.getItem(TREE_KEY)); } catch (_) { /* nothing saved */ }
      if (!saved) throw new Error("No network, and nothing was saved on this device yet.");
      return { files: saved, offline: true };
    }
  }

  function blobKey(sha) { return "./__blob/" + sha; }

  /* File bytes, content-addressed: a sha already on this device never hits the
   * network again, which is what makes offline rehearsal work. */
  async function file(config, files, path) {
    path = safePath(path);
    var sha = files[path];
    if (!sha) throw new Error("Not found in the data repository: " + path);
    var cache = root.caches ? await root.caches.open(CACHE) : null;
    var hit = cache && await cache.match(blobKey(sha));
    if (hit) return hit.arrayBuffer();
    var url = "https://api.github.com/repos/" + config.repo + "/contents/" +
      path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(config.branch);
    var buffer = await (await request(config, url, "application/vnd.github.raw")).arrayBuffer();
    if (cache) {
      try { await cache.put(blobKey(sha), new Response(buffer.slice(0))); } catch (_) { /* storage full: play anyway */ }
    }
    return buffer;
  }

  /* Drop cached files that are no longer in the repository. */
  async function prune(files) {
    if (!root.caches) return;
    var keep = {};
    Object.keys(files).forEach(function (path) { keep[files[path]] = true; });
    var cache = await root.caches.open(CACHE), keys = await cache.keys();
    await Promise.all(keys.map(function (req) {
      if (!keep[req.url.split("/__blob/")[1]]) return cache.delete(req);
    }));
  }

  function slug(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song";
  }
  /* songs.json -> clean song records. Unknown fields are ignored. */
  function readManifest(text) {
    var data;
    try { data = JSON.parse(text); } catch (_) { throw new Error("songs.json is not valid JSON."); }
    var list = Array.isArray(data) ? data : data && data.songs;
    if (!Array.isArray(list)) throw new Error("songs.json must contain a \"songs\" list.");
    var seen = {};
    return list.map(function (song, i) {
      if (!song || !song.midi) throw new Error("Song " + (i + 1) + " in songs.json has no \"midi\" file.");
      var title = String(song.title || song.midi), id = slug(song.id || title);
      while (seen[id]) id += "-2";
      seen[id] = true;
      return {
        id: id, title: title, artist: String(song.artist || ""),
        midi: safePath(song.midi),
        full: song.full ? safePath(song.full) : null,
        backing: song.backing ? safePath(song.backing) : null,
        offsetMs: Number(song.offsetMs) || 0,
        midiOffsetMs: Number(song.midiOffsetMs) || 0,
        track: Number.isInteger(song.track) ? song.track : null
      };
    });
  }

  var api = {
    encodeLink: encodeLink, decodeLink: decodeLink, extractCode: extractCode,
    readConfig: readConfig, writeConfig: writeConfig, clean: clean,
    tree: tree, file: file, prune: prune, readManifest: readManifest
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprSource = api;
})(typeof window !== "undefined" ? window : globalThis);
