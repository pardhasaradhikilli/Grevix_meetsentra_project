// Pure logic for lecture mode, video visibility, the speaking queue and the anonymous question box.
export const ALL_PANELS = ['chatPanel', 'hostPanel', 'seesPanel', 'reportPanel', 'alertsPanel', 'mySettings', 'hostSettings', 'qaPanel', 'summaryPanel'];
export const MODES = ['all', 'host', 'reveal'];

// Validate settings that arrive over the network (never trust their shape).
export function cleanSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    mode: MODES.includes(o.mode) ? o.mode : 'all',
    speaker: typeof o.speaker === 'string' && o.speaker ? o.speaker : null,
    perms: {
      chat: ['all', 'host', 'off'].includes(o.perms?.chat) ? o.perms.chat : 'all',
      unmute: ['all', 'floor'].includes(o.perms?.unmute) ? o.perms.unmute : 'all',
    },
    questions: o.questions !== false,
  };
}

// Who is connected to whom (video and audio travel directly between connected people).
//  all:    everyone sees everyone.
//  host:   LECTURE MODE: participants connect only to the host. They never receive each other's video.
//  reveal: like lecture mode, but a participant who chooses "show my video" is seen by everyone.
// Whoever has the floor (the speaker) is connected to everyone in the two lecture modes.
export function shouldConnect(mode, a, b, speakerUid) {
  if (a.uid === b.uid) return false;
  if (mode === 'all') return true;
  if (a.host || b.host) return true;
  if (speakerUid && (a.uid === speakerUid || b.uid === speakerUid)) return true;
  if (mode === 'reveal' && (a.revealed || b.revealed)) return true;
  return false;
}
// Peer-to-peer limit. A star (host in the middle) is much lighter than a full mesh, so it can hold more.
export const videoLimit = (mode) => (mode === 'all' ? 6 : 12);

export class SpeakQueue {
  constructor() { this.list = []; }
  add(uid, name, at) { if (!this.list.some((x) => x.uid === uid)) this.list.push({ uid, name: String(name).slice(0, 40), at }); }
  remove(uid) { this.list = this.list.filter((x) => x.uid !== uid); }
  position(uid) { const i = this.list.findIndex((x) => x.uid === uid); return i < 0 ? 0 : i + 1; }
}

export class QuestionBox {
  constructor(max = 200) { this.items = new Map(); this.max = max; }
  add({ id, text }, at = Date.now()) {
    const t = String(text ?? '').trim().slice(0, 300);
    if (!id || !t || this.items.has(id) || this.items.size >= this.max) return false;
    this.items.set(id, { id: String(id), text: t, at, votes: 0, answered: false, hidden: false });
    return true;
  }
  vote(id) { const q = this.items.get(id); if (q && !q.answered) q.votes++; }
  toggleAnswered(id) { const q = this.items.get(id); if (q) q.answered = !q.answered; }
  hide(id) { const q = this.items.get(id); if (q) q.hidden = true; }
  sorted() { // open questions by votes, then oldest first; answered ones last; hidden ones never
    return [...this.items.values()].filter((q) => !q.hidden)
      .sort((a, b) => a.answered - b.answered || b.votes - a.votes || a.at - b.at);
  }
  toJSON() { return this.sorted(); }
}
// Clean a list received from the host.
export function cleanQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 200).filter((q) => q && q.id && typeof q.text === 'string').map((q) => ({
    id: String(q.id).slice(0, 40), text: q.text.slice(0, 300), votes: Math.max(0, Number(q.votes) || 0), answered: !!q.answered }));
}
