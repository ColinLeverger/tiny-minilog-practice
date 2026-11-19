const test = require("node:test");
const assert = require("node:assert");
const Source = require("../js/source.js");

const config = { repo: "someone/songs", branch: "main", token: "github_pat_abc_123" };

test("a link code carries repository, branch and token, and round-trips", () => {
  const code = Source.encodeLink(config);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepStrictEqual(Source.decodeLink(code), config);
});

test("the code is found in the fragment or the query, and removed from the URL", () => {
  const code = Source.encodeLink(config);
  const a = Source.extractCode("https://x.github.io/app/#k=" + code);
  assert.strictEqual(a.code, code);
  assert.strictEqual(a.cleaned, "https://x.github.io/app/");
  const b = Source.extractCode("https://x.github.io/app/?k=" + code + "&keep=1");
  assert.strictEqual(b.code, code);
  assert.strictEqual(b.cleaned, "https://x.github.io/app/?keep=1");
  assert.strictEqual(Source.extractCode("https://x.github.io/app/").code, null);
});

test("a damaged or incomplete link is refused", () => {
  assert.throws(() => Source.decodeLink("not-a-code"), /damaged/);
  assert.throws(() => Source.encodeLink({ repo: "no-slash", branch: "main", token: "t" }), /owner\/repository/);
  assert.throws(() => Source.encodeLink({ repo: "a/b", branch: "main", token: "" }), /token/);
});

test("songs.json becomes clean song records", () => {
  const songs = Source.readManifest(JSON.stringify({ songs: [
    { title: "First Song", midi: "first/bass.mid", full: "first/full.mp3", backing: "first/nobass.mp3", offsetMs: 25 },
    { title: "First Song", midi: "second/bass.mid" }
  ] }));
  assert.strictEqual(songs[0].id, "first-song");
  assert.notStrictEqual(songs[1].id, songs[0].id);
  assert.strictEqual(songs[0].offsetMs, 25);
  assert.strictEqual(songs[1].full, null);
});

test("songs.json cannot point outside the repository", () => {
  assert.throws(() => Source.readManifest(JSON.stringify({ songs: [{ midi: "../other/bass.mid" }] })), /Unsafe/);
  assert.throws(() => Source.readManifest(JSON.stringify({ songs: [{ title: "x" }] })), /no "midi"/);
  assert.throws(() => Source.readManifest("{"), /not valid JSON/);
});

test("a file is fetched once with the token, then served from the device", async () => {
  const calls = [], store = new Map();
  globalThis.caches = { open: async () => ({
    match: async (key) => store.get(key),
    put: async (key, response) => { store.set(key, response); }
  }) };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    const files = { "a song/bass.mid": "sha1" };
    const first = await Source.file(config, files, "a song/bass.mid");
    assert.deepStrictEqual([...new Uint8Array(first)], [1, 2, 3]);
    assert.strictEqual(calls[0].url, "https://api.github.com/repos/someone/songs/contents/a%20song/bass.mid?ref=main");
    assert.strictEqual(calls[0].init.headers.Authorization, "Bearer github_pat_abc_123");
    assert.strictEqual(calls[0].init.headers.Accept, "application/vnd.github.raw");
    store.set("./__blob/sha1", new Response(new Uint8Array([1, 2, 3]))); // a Response body reads once
    const second = await Source.file(config, files, "a song/bass.mid");
    assert.deepStrictEqual([...new Uint8Array(second)], [1, 2, 3]);
    assert.strictEqual(calls.length, 1, "second read must not hit the network");
    await assert.rejects(Source.file(config, files, "missing.mp3"), /Not found/);
  } finally { delete globalThis.caches; delete globalThis.fetch; }
});

test("an expired token gives the friend a sentence they can act on", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  try { await assert.rejects(Source.tree(config), /expired or was revoked/); }
  finally { delete globalThis.fetch; }
});

test("songs.json can give a tempo and marker notes to drop", () => {
  const [song] = Source.readManifest(JSON.stringify({ songs: [{ midi: "a/bass.mid", bpm: 128, ignoreNotes: [64, "x", 66] }] }));
  assert.strictEqual(song.bpm, 128);
  assert.deepStrictEqual(song.ignoreNotes, [64, 66]);
});

test("the whole library is saved for offline use, skipping files already on the device", async () => {
  const fetched = [], store = new Map([["./__blob/sha-a-mid", new Response("x")]]);
  globalThis.caches = { open: async () => ({
    match: async (key) => store.get(key),
    put: async (key, response) => { store.set(key, response); }
  }) };
  globalThis.fetch = async (url) => { fetched.push(url.split("/contents/")[1].split("?")[0]); return new Response("y"); };
  try {
    const files = { "a/bass.mid": "sha-a-mid", "a/nobass.mp3": "sha-a-back", "b/bass.mid": "sha-b-mid", "b/full.mp3": "sha-b-full" };
    const songs = [
      { midi: "a/bass.mid", backing: "a/nobass.mp3", full: null },
      { midi: "b/bass.mid", backing: null, full: "b/full.mp3" },
      { midi: "a/bass.mid", backing: null, full: null } // same file twice is fetched once
    ];
    const seen = [];
    const state = await Source.preload(config, files, songs, (s) => seen.push(s.done));
    assert.deepStrictEqual(state, { done: 4, total: 4, failed: 0 });
    assert.deepStrictEqual(fetched, ["a/nobass.mp3", "b/bass.mid", "b/full.mp3"], "cached file must not be downloaded again");
    assert.deepStrictEqual(seen, [1, 2, 3, 4]);
  } finally { delete globalThis.caches; delete globalThis.fetch; }
});

test("saving the library stops at the first sign of no network", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try {
    const files = { "a.mid": "1", "b.mid": "2", "c.mid": "3" };
    const state = await Source.preload(config, files, [{ midi: "a.mid" }, { midi: "b.mid" }, { midi: "c.mid" }]);
    assert.deepStrictEqual(state, { done: 0, total: 3, failed: 1 });
  } finally { delete globalThis.fetch; }
});
