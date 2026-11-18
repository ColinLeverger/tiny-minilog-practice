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
