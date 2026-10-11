// Pure logic for the attendance / engagement report (no browser needed, so it can be tested).
export const BUCKETS = ['engaged', 'active_secondary', 'passive_absent', 'spoof_suspect', 'excused', 'no_data'];

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export class Attendance {
  constructor() { this.people = new Map(); this.timeline = []; this.lastTimelineAt = 0; }

  // members: [{ uid, name }], getState: uid -> state string or undefined, dtSec: seconds since last sample
  sample(now, members, getState, dtSec) {
    const present = new Set();
    let reporting = 0, fine = 0;
    for (const m of members) {
      present.add(m.uid);
      let p = this.people.get(m.uid);
      if (!p) {
        p = { name: m.name, firstSeen: now, lastSeen: now, present: true, secs: Object.fromEntries(BUCKETS.map((b) => [b, 0])) };
        this.people.set(m.uid, p);
      }
      p.name = m.name; p.lastSeen = now; p.present = true;
      const st = getState(m.uid) || 'no_data';
      const key = BUCKETS.includes(st) ? st : 'no_data';
      p.secs[key] += dtSec;
      if (key !== 'no_data') { reporting++; if (key === 'engaged' || key === 'active_secondary' || key === 'excused') fine++; }
    }
    for (const [uid, p] of this.people) if (!present.has(uid)) p.present = false;
    if (reporting && now - this.lastTimelineAt >= 30000) {
      this.timeline.push({ t: now, pct: Math.round((100 * fine) / reporting), n: reporting });
      this.lastTimelineAt = now;
    }
  }

  rows() {
    return [...this.people.values()].map((p) => {
      const s = p.secs, total = Object.values(s).reduce((a, b) => a + b, 0), withData = total - s.no_data;
      const min = (x) => Math.round((x / 60) * 10) / 10;
      return {
        name: p.name, firstSeen: p.firstSeen, lastSeen: p.lastSeen, present: p.present,
        totalMin: min(total), engagedMin: min(s.engaged), workingMin: min(s.active_secondary),
        awayMin: min(s.passive_absent + s.spoof_suspect), excusedMin: min(s.excused), noDataMin: min(s.no_data),
        engagedPct: withData > 0 ? Math.round((100 * (s.engaged + s.active_secondary)) / withData) : null,
      };
    });
  }

  toCSV(fmtTime = (ms) => new Date(ms).toLocaleTimeString()) {
    const head = ['Name', 'Joined', 'Last seen', 'Minutes in meeting', 'Engaged min', 'Working on something else min',
      'Away min', 'Be right back min', 'No engagement data min', 'Engaged or working %'];
    const lines = this.rows().map((r) => [r.name, fmtTime(r.firstSeen), fmtTime(r.lastSeen), r.totalMin, r.engagedMin,
      r.workingMin, r.awayMin, r.excusedMin, r.noDataMin, r.engagedPct ?? ''].map(csvCell).join(','));
    return [head.map(csvCell).join(','), ...lines].join('\n');
  }
}
