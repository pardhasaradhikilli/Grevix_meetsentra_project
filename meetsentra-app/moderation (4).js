// Rule-based chat filter (runs in the sender's browser before a message is sent).
// Covers: English, Hindi/Hinglish and Telugu typed in English letters (small starter lists),
// plus ANY language in its own script, through words the host adds for the class.
// It does not understand meaning: only a human-reviewed word list can be matched.

const BAD_EN = ['fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore',
  'idiot', 'stupid', 'moron', 'dumb', 'loser', 'retard', 'motherfucker'];

// Starter lists in English letters. Spelling varies a lot, so near-matches (1 typo) are caught too.
// PLEASE have a native speaker review these and extend them for your class.
const BAD_HINGLISH = ['madarchod', 'bhenchod', 'behenchod', 'chutiya', 'gandu', 'gaandu', 'harami', 'haramkhor',
  'bhosdike', 'bhosdi', 'randi', 'kamina', 'kamine'];
const BAD_TENGLISH = ['lanjakoduku', 'lanjakodaka', 'lanja', 'erripuka'];

const BAD = [...BAD_EN, ...BAD_HINGLISH, ...BAD_TENGLISH];
const EXTRA = new Set();        // host words in English letters
const EXTRA_SCRIPT = new Set(); // host words in other scripts (Telugu, Hindi, ...): matched as substrings

const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };

function normalize(text) {
  return text.toLowerCase().normalize('NFC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')                 // invisible joiners used to dodge filters
    .replace(/[@40!13$57]/g, (c) => LEET[c])
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')                      // keep letters and marks of ANY script
    .replace(/(.)\1{2,}/gu, '$1$1').replace(/\s+/g, ' ').trim();
}

const isLatin = (w) => /^[a-z]+$/.test(w);
const collapse = (w) => w.replace(/(.)\1/g, '$1');

// true if a and b differ by at most one letter (typo, missing or extra letter)
function within1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function addWords(list) {
  for (const raw of list) {
    const n = normalize(String(raw));
    const joined = n.replace(/\s+/g, '');
    if (isLatin(joined)) { if (joined.length >= 2) EXTRA.add(joined); }
    else if ([...n].length >= 3) EXTRA_SCRIPT.add(n);       // Indic words take suffixes, so match inside words
  }
}

export function checkMessage(text) {
  const norm = normalize(text);

  for (const w of EXTRA_SCRIPT) if (norm.includes(w)) return { blocked: true, word: w };

  const tokens = norm.split(' '), words = [];
  let run = '';
  for (const t of tokens) {                                  // join runs of single letters: "f u c k" -> "fuck"
    if (/^[a-z]$/.test(t)) run += t;
    else { if (run) { words.push(run); run = ''; } words.push(t); }
  }
  if (run) words.push(run);

  const list = [...BAD, ...EXTRA];
  for (const w of words) {
    if (!isLatin(w)) continue;
    const c = collapse(w);
    for (const b of list) {
      if (w === b || c === b || c === collapse(b)) return { blocked: true, word: b };
      if (b.length >= 6 && w.length >= 6 && within1(w, b)) return { blocked: true, word: b };
    }
  }
  return { blocked: false, word: null };
}
