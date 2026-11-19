/* French for a browser set to French; English everywhere else. The English
 * sentence is the key: the code keeps writing English, and every text on its
 * way to the screen goes through t(). Sentences with a variable part (a file
 * name, a count) are templates: {0}, {1} stand for the variable parts.
 * ?lang=fr or ?lang=en in the address forces a language. */
(function (root) {
  "use strict";
  var FR = {
    // header, footer
    "Song": "Morceau",
    "Backing track": "Accompagnement",
    "With bass": "Avec basse",
    "No bass": "Sans basse",
    "Silent": "Muet",
    "Guide bass": "Basse guide",
    "Full screen": "Plein écran",
    "Exit full screen": "Quitter le plein écran",
    "Install": "Installer",
    "Installed": "Installée",
    "Settings": "Réglages",
    "Turn your": "Tournez votre",
    "tablet": "tablette",
    "phone": "téléphone",
    "sideways for bigger keys. You can still play this way.": "à l’horizontale pour des touches plus grandes. Vous pouvez aussi jouer comme ça.",
    "Keyboard with the notes to play. Touch a key to play it.": "Clavier avec les notes à jouer. Touchez une touche pour la jouer.",
    "Keyboard with the notes to play": "Clavier avec les notes à jouer",
    "Bass neck with the notes to play": "Manche de basse avec les notes à jouer",
    "Play": "Lecture",
    "Pause": "Pause",
    "Start": "Début",
    "Speed": "Vitesse",
    "Slower by 10%": "10 % plus lent",
    "Faster by 10%": "10 % plus rapide",
    "Position": "Position",
    "Repeat a passage": "Répéter un passage",
    "Set A": "Point A",
    "Set B": "Point B",
    "Set loop start A": "Placer le début de boucle A",
    "Set loop end B": "Placer la fin de boucle B",
    "Loop off": "Sans boucle",

    // settings
    "Close": "Fermer",
    "Volume": "Volume",
    "Keys you touch": "Touches que vous jouez",
    "Screen": "Écran",
    "Show": "Afficher",
    "Keyboard": "Clavier",
    "Bass neck": "Manche de basse",
    "Falling notes": "Notes qui tombent",
    "Lights only": "Lumières seules",
    "Dots on the notes of the key": "Points sur les notes de la tonalité",
    "Key dots": "Avec points",
    "No dots": "Sans points",
    "◀ Notes left": "◀ Notes à gauche",
    "Notes right ▶": "Notes à droite ▶",
    "Notes visible ahead": "Notes visibles à l’avance",
    "Timing": "Synchro",
    "Keys light up before you hear the note? Move right.": "Les touches s’allument avant d’entendre la note ? Glissez à droite.",
    "Bluetooth headphones usually need about 200 ms.": "Un casque Bluetooth demande en général environ 200 ms.",
    "Keep it on this tablet": "La garder sur cette tablette",
    "Keep it on this device": "La garder sur cet appareil",
    "In Chrome, tap the three-dot menu (⋮) → Add to home screen → Install. If Chrome offers Create shortcut instead, use it, then tap Full screen here when you play.":
      "Dans Chrome, touchez le menu à trois points (⋮) → Ajouter à l’écran d’accueil → Installer. Si Chrome propose plutôt Créer un raccourci, prenez-le, puis touchez Plein écran ici pour jouer.",
    "Next time, open the TinyPiano icon on your home screen. An installed app opens without browser bars.":
      "La prochaine fois, ouvrez l’icône TinyPiano de l’écran d’accueil. Une appli installée s’ouvre sans les barres du navigateur.",
    "Ready on this tablet. Next time, tap the TinyPiano icon on your home screen.":
      "Prête sur cette tablette. La prochaine fois, touchez l’icône TinyPiano de l’écran d’accueil.",
    "In Safari, tap Share (the square with an arrow) → Add to Home Screen. The icon then opens without browser bars.":
      "Dans Safari, touchez Partager (le carré avec une flèche) → Sur l’écran d’accueil. L’icône s’ouvre ensuite sans les barres du navigateur.",
    "Full screen is unavailable here. Use Chrome’s menu (⋮) → Add to home screen → Install, then open the TinyPiano icon.":
      "Le plein écran n’est pas disponible ici. Utilisez le menu de Chrome (⋮) → Ajouter à l’écran d’accueil → Installer, puis ouvrez l’icône TinyPiano.",
    "Setup (adding songs)": "Configuration (ajouter des morceaux)",
    "Try files from this device": "Essayer des fichiers de cet appareil",
    "Bass MIDI": "MIDI de la basse",
    "Tempo in BPM, only when the MIDI file has none": "Tempo en BPM, seulement si le fichier MIDI n’en a pas",
    "Song with bass": "Morceau avec basse",
    "Song without bass": "Morceau sans basse",
    "Load these files": "Charger ces fichiers",
    "Song library (private GitHub repository)": "Bibliothèque de morceaux (dépôt GitHub privé)",
    "Repository": "Dépôt",
    "owner/repository": "propriétaire/dépôt",
    "Branch": "Branche",
    "Read-only token": "Jeton en lecture seule",
    "Save and load": "Enregistrer et charger",
    "Copy link for a friend": "Copier le lien pour un ami",
    "Forget on this device": "Oublier sur cet appareil",
    "Link for a friend": "Lien pour un ami",
    "The link contains the token. Whoever has it can read the song repository. Send it privately.":
      "Le lien contient le jeton. Qui l’a peut lire le dépôt des morceaux. Envoyez-le en privé.",
    "Choose at least the bass MIDI file.": "Choisissez au moins le fichier MIDI de la basse.",
    "Link copied. Send it privately.": "Lien copié. Envoyez-le en privé.",
    "Copy the link above by hand.": "Copiez le lien ci-dessus à la main.",
    "Forgotten. Saved songs were removed from this device.": "Oublié. Les morceaux enregistrés ont été retirés de cet appareil.",

    // songs, loading, offline
    "Demo (guide bass only)": "Démo (basse guide seule)",
    "Loading songs…": "Chargement des morceaux…",
    "Loading audio…": "Chargement du son…",
    "Loading {0}…": "Chargement de {0}…",
    "Preparing the slower recording…": "Préparation de l’enregistrement ralenti…",
    "This audio file could not be read.": "Ce fichier audio est illisible.",
    "songs.json lists no song yet.": "songs.json ne contient encore aucun morceau.",
    "No notes found in the MIDI file of {0}.": "Aucune note dans le fichier MIDI de {0}.",
    "Saving songs on this device…": "Enregistrement des morceaux sur cet appareil…",
    "Saving songs on this device: {0} of {1} files…": "Enregistrement des morceaux sur cet appareil : {0} fichiers sur {1}…",
    "All {0} songs are saved on this device and play with no network.": "Les {0} morceaux sont sur cet appareil et se jouent sans réseau.",
    "{0} of {1} files saved. The others download when you open their song with a network.":
      "{0} fichiers sur {1} enregistrés. Les autres se téléchargent à l’ouverture de leur morceau, avec du réseau.",
    "Saving songs for offline use failed. Songs you open are still saved.":
      "L’enregistrement hors ligne a échoué. Les morceaux que vous ouvrez sont quand même enregistrés.",
    "No network: playing what is already on this device.": "Pas de réseau : lecture de ce qui est déjà sur cet appareil.",

    // key
    "Key: {0}  ·  dots = notes that fit": "Tonalité : {0}  ·  points = notes qui vont bien",
    "This song is in {0}. Dots mark the notes that fit it; the ringed dot is {1}, the home note.":
      "Ce morceau est en {0}. Les points marquent les notes qui vont avec ; le point cerclé marque la note de repos ({1}).",

    // errors from the song library and the MIDI reader
    "Use owner/repository for the repository name.": "Écrivez le dépôt sous la forme propriétaire/dépôt.",
    "A fine-grained GitHub token is required.": "Un jeton GitHub à accès limité est nécessaire.",
    "A branch is required.": "Une branche est nécessaire.",
    "This link is damaged. Ask for a new one.": "Ce lien est abîmé. Demandez-en un nouveau.",
    "This link has expired or was revoked. Ask for a new one.": "Ce lien a expiré ou a été révoqué. Demandez-en un nouveau.",
    "GitHub refused the request (rate limit or permissions). Try again later.": "GitHub a refusé la demande (limite atteinte ou droits). Réessayez plus tard.",
    "GitHub returned {0}.": "GitHub a répondu {0}.",
    "Not found in the data repository: {0}": "Introuvable dans le dépôt des morceaux : {0}",
    "Unsafe file path in the song list: {0}": "Chemin de fichier dangereux dans la liste des morceaux : {0}",
    "No network.": "Pas de réseau.",
    "No network, and nothing was saved on this device yet.": "Pas de réseau, et rien n’est encore enregistré sur cet appareil.",
    "songs.json is not valid JSON.": "songs.json n’est pas du JSON valide.",
    "songs.json must contain a \"songs\" list.": "songs.json doit contenir une liste \"songs\".",
    "Song {0} in songs.json has no \"midi\" file.": "Le morceau {0} de songs.json n’a pas de fichier \"midi\".",
    "Not a MIDI file.": "Ce n’est pas un fichier MIDI.",
    "MIDI file is truncated.": "Le fichier MIDI est tronqué.",
    "MIDI file has no time division.": "Le fichier MIDI n’a pas de division temporelle.",
    "MIDI track is corrupt.": "La piste MIDI est corrompue.",
    "SMPTE-timed MIDI is not supported; export with tempo-based timing.": "Le MIDI en temps SMPTE n’est pas pris en charge ; exportez avec un temps basé sur le tempo."
  };
  // French note names, as a French musician reads them
  var NOTES_FR = ["do", "do♯", "ré", "mi♭", "mi", "fa", "fa♯", "sol", "la♭", "la", "si♭", "si"];

  function escape(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  var PATTERNS = Object.keys(FR).filter(function (k) { return /\{\d\}/.test(k); }).map(function (k) {
    return { re: new RegExp("^" + escape(k).replace(/\\\{\d\\\}/g, "([\\s\\S]*?)") + "$"), fr: FR[k] };
  });

  function pick(languages, href) {
    var forced = /[?&#]lang=(fr|en)\b/.exec(href || "");
    if (forced) return forced[1];
    var first = (languages && languages[0]) || "";
    return /^fr\b/i.test(first) ? "fr" : "en";
  }

  function create(lang) {
    function t(text) {
      if (lang !== "fr" || text == null) return text;
      text = String(text);
      if (Object.prototype.hasOwnProperty.call(FR, text)) return FR[text];
      for (var i = 0; i < PATTERNS.length; i++) {
        var m = PATTERNS[i].re.exec(text);
        if (m) return PATTERNS[i].fr.replace(/\{(\d)\}/g, function (_, n) { return m[Number(n) + 1]; });
      }
      return text;
    }
    /* "E minor" in English, "mi mineur" in French. */
    function keyName(key) {
      if (!key) return "";
      return lang === "fr" ? NOTES_FR[key.tonic] + (key.minor ? " mineur" : " majeur") : key.name;
    }
    function tonicName(key) { return keyName(key).split(" ")[0]; }
    /* Translate the page as written in index.html: text and the labels a
     * screen reader reads. Leading and trailing spaces stay where they are. */
    function page(doc) {
      if (lang !== "fr") return;
      doc.documentElement.lang = "fr";
      var walker = doc.createTreeWalker(doc.body, 4 /* text */), node;
      while ((node = walker.nextNode())) {
        var trimmed = node.nodeValue.trim();
        if (trimmed && t(trimmed) !== trimmed) node.nodeValue = node.nodeValue.replace(trimmed, t(trimmed));
      }
      ["aria-label", "placeholder"].forEach(function (name) {
        doc.querySelectorAll("[" + name + "]").forEach(function (el) { el.setAttribute(name, t(el.getAttribute(name))); });
      });
    }
    return { lang: lang, t: t, keyName: keyName, tonicName: tonicName, page: page };
  }

  var nav = root.navigator || {};
  var api = create(pick(nav.languages && nav.languages.length ? nav.languages : [nav.language], root.location && root.location.href));
  api.create = create; api.pick = pick; api.FR = FR;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TprI18n = api;
})(typeof window !== "undefined" ? window : globalThis);
