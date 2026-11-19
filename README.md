# Tiny Piano Rehearsal

Press play, follow the lit keys. A bass line for a 25-key synth (Korg
Monologue, E to E), shown as falling notes over a drawing of the keyboard and kept in
sync with the song. No sheet music, no theory.

Static site, no build step, no server. Songs live in a separate **private**
GitHub repository and are read with a read-only token carried in the link.

## What the player gets

- **With bass / No bass / Silent**: which recording plays behind the picture.
- **Guide bass**: the app plays the bass line itself, with a sound built to be
  heard on a tablet speaker (harmonics) and in headphones (real sub).
- **Falling notes**: a bar reaches the keyboard when the key must go down, and
  its length is how long to hold it. Faint lines are beats, strong lines bars.
- **Colours**: teal = white key, violet = black key, amber = the note is
  outside the 25 keys and was moved by octaves so there is still a key to press.
- **− 100% +**: slow everything down by steps of 10%, down to 50%. The
  recording keeps its pitch (it is time-stretched on the device, which takes a
  second or two the first time and adds some blur at low speeds), so the synth
  stays in tune with it. Guide bass, falling notes and loop follow. While
  "Preparing the slower recording…" shows, the song plays on at the previous
  speed; it then switches at the same point in the song. Slowed copies stay
  within 6 ms of the song's timing from the first bar to the last.
- **Bass neck** (*Settings → Screen*): the same falling notes over a bass
  neck instead of the keyboard. One column per fret (the first one is the
  open string), notes in their string's colour with the fret number on them,
  and the neck lights the string and fret to press. Strings are in tab order,
  G at the top and low E at the bottom. 4-string bass, standard tuning. Each
  note is placed where it is easiest to play: the app keeps the hand in one
  four-fret position, uses open strings, prefers low frets and only moves the
  hand when the line needs it. A link ending in `#v=bass` opens straight on
  the neck (`#v=keys` for the keyboard).
- **Falling notes / Lights only** (*Settings → Screen*): hide the falling
  notes, for keyboard and neck alike. The instrument then grows and only
  lights up, with a dashed outline on the next key or fret to press.
- **Play it yourself**: touch a key, or a string at a fret on the bass neck,
  and it sounds for as long as the finger stays down. Several fingers at once
  work, and sliding a finger plays every key or fret it crosses. It works
  stopped or along with the song, guide bass on or off. Touches on the falling
  notes above the instrument do nothing. Its volume is *Settings → Volume →
  Keys you touch*.
- **Key dots** (*Settings → Screen*): a small dot on every key, and every
  string and fret, that belongs to the song's key, so the player can try
  other notes that fit without following the line. The ringed dot is the home
  note. The app works the key out from the bass line (longer notes count
  more); `key` in songs.json overrides it when it guesses wrong. The key's
  name shows in Settings and at the top of the picture.
- **A / B / Loop off**: repeat a passage. **−5 s** and **Start** to go back.
- **Settings**: volumes, moving the notes one octave left or right, how far
  ahead notes show, full screen, and timing (for Bluetooth headphones). Loading
  files and the song library sit folded under *Setup (adding songs)*.

**Offline**: once the song list loads with a network, the app downloads every
song of the library in the background (*Settings* shows the progress), so the
next rehearsal needs no network at all, including songs never opened. Files
already on the device are not downloaded again; a song changed in the data
repository is fetched anew on the next online visit. The app also asks the
browser to keep these files when storage runs low.

On an Android tablet, tap **Install** to add TinyPiano to the home screen. If
Chrome does not offer the install prompt, the button shows instructions for
Chrome’s three-dot menu on the same tablet. Open the TinyPiano icon next time
for a view without browser bars, or tap **Full screen** while playing in a tab.
Landscape gives the largest keys; portrait keeps all controls available and
shows a reminder to turn the tablet.

## Adding songs (the private data repository)

Layout, at the root of the data repository:

```text
songs.json
my-song/full.mp3      song with bass
my-song/nobass.mp3    song without bass
my-song/bass.mid      the bass line
```

```json
{ "songs": [
  { "title": "My Song", "artist": "The Band",
    "full": "my-song/full.mp3", "backing": "my-song/nobass.mp3", "midi": "my-song/bass.mid",
    "offsetMs": 0 }
] }
```

| Field | Meaning |
| --- | --- |
| `title`, `midi` | Required. |
| `full`, `backing` | Optional. A missing one greys its button out. |
| `artist` | Optional, shown in the song list. |
| `offsetMs` | Silence at the start of the audio files that the MIDI does not have. MP3 encoders add 25 to 50 ms; raise it when the lights run ahead of the recording. |
| `midiOffsetMs` | Shifts the notes instead, for a MIDI exported from the first note rather than from bar 1. |
| `track` | Track number (from 0) when the MIDI holds more than the bass. |
| `bpm` | Song tempo, used only when the MIDI file states none. Without it such a file is read at 120 and drifts. |
| `key` | The song's key, for the key dots, when the app guesses it wrong: `"E minor"`, `"Em"`, `"F#"`, `"Bb major"`. |
| `ignoreNotes` | MIDI note numbers to drop, e.g. marker notes placed at the start and end to force a full-length export: `[64, 66]`. |

Export rules, or nothing lines up: the three files come from the **same
project at the same tempo**, and all three **start at the project start** (bar
1), not at the first note. Files up to 100 MB each.

Pushing to the data repository is the whole publishing step; the app sees the
change on its next load.

## The link for a friend

1. Create a **private** repository for the songs.
2. Create a fine-grained personal access token limited to **that repository
   only**, with **Repository permissions → Contents: Read-only**, and an expiry
   date.
3. In the app: *Settings → Setup → Song library*, enter `owner/repository`, the branch
   and the token, then **Copy link for a friend**.

The link ends in `#k=…`: the repository, branch and token, encoded. Opening it
stores them on the device and removes them from the address bar. The friend
configures nothing.

The link **is** the token. Anyone who gets it can read the song repository
until the token expires or is revoked, so send it privately and never paste it
in a public place (GitHub revokes tokens it finds in public repositories). The
code sits in the fragment because a fragment is never sent to a server;
`?k=…` is accepted too.

## Which octave on the synth

The app chooses the two octaves (E to E) that hold the most notes and puts the
lowest ones at the left. Which octave *sounds* right depends on the synth's OCTAVE
switch and on the patch, so set those by ear against the "With bass" recording.
*Settings → Notes left / Notes right* shifts the picture when the line is
more comfortable an octave to the right.

## Development

```sh
make          # list targets
make run      # serve on http://localhost:8137
make smoke    # the page and its files answer
make check    # tests (memory-capped), the gate CI runs
make down
```

With no link, the app opens on a built-in demo. *Settings → Setup → Try files from this
device* loads a MIDI and two audio files straight from disk, which is the quick
way to check an export before pushing it.

| File | Role |
| --- | --- |
| `js/midi.js` | MIDI file → notes in seconds (tempo map, beats). |
| `js/fretboard.js` | Bass neck: tunings, and the easiest place to play each note. |
| `js/layout.js` | The 25 keys, and where a note lands on them. |
| `js/theory.js` | The song's key, from its notes or from songs.json. |
| `js/source.js` | Link code, GitHub reads, on-device cache keyed by content hash, saving the whole library for offline use. |
| `js/stretch.js` | Slows a recording down without changing its pitch. |
| `js/engine.js` | Web Audio transport: recording, guide bass, loop, one clock; notes played by touch. |
| `js/app.js` | Controls and the canvas. |
| `sw.js` | Caches the app shell for offline use. |

Deploy: push to `main`; the workflow runs `make check`, then publishes to GitHub
Pages (Settings → Pages → Source: *GitHub Actions*).
