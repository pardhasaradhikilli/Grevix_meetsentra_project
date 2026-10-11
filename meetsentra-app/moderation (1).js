// Rule-based chat filter. Extend BAD with words your classes need (other languages too).
const BAD = ['fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore',
  'idiot', 'stupid', 'moron', 'dumb', 'loser', 'retard', 'motherfucker'];

const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };

function normalize(text) {
  return text.toLowerCase().replace(/[@40!13$57]/g, (c) => LEET[c]).replace(/[^a-z\s]/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1').replace(/\s+/g, ' ').trim();
}

export function checkMessage(text) {
  const norm = normalize(text);
  const tokens = norm.split(' ');
  // join runs of single letters: "f u c k" -> "fuck"
  const words = [];
  let run = '';
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else { if (run) { words.push(run); run = ''; } words.push(t); }
  }
  if (run) words.push(run);
  const hit = words.find((w) => BAD.includes(w) || BAD.includes(w.replace(/(.)\1/g, '$1')));
  return { blocked: !!hit, word: hit || null };
}
