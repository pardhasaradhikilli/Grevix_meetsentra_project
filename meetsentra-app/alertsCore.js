// One alert feed for the host. Pure logic (no browser), so it can be tested.
export const SEV = { urgent: 3, attention: 2, info: 1 };

export const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export class AlertFeed {
  constructor({ cooldownMs = 5 * 60_000, maxItems = 150 } = {}) {
    this.items = []; this.nextId = 1; this.dismissedUntil = new Map();
    this.cooldownMs = cooldownMs; this.maxItems = maxItems;
  }
  _make(now, c, kind, ttlMs) {
    const a = { id: this.nextId++, key: c.key, kind, severity: c.severity, title: c.title, detail: c.detail || '',
      at: now, resolvedAt: null, dismissed: false, expiresAt: ttlMs ? now + ttlMs : null };
    this.items.push(a);
    if (this.items.length > this.maxItems) { const i = this.items.findIndex((x) => x.resolvedAt || x.dismissed); if (i >= 0) this.items.splice(i, 1); }
    return a;
  }

  // Alerts for ongoing situations. conditions = [{ key, severity, title, detail }].
  // New ones are raised, changed ones updated, and ones that ended are resolved. Returns newly raised alerts.
  sync(now, conditions) {
    const keys = new Set(conditions.map((c) => c.key)), added = [];
    for (const c of conditions) {
      const a = this.items.find((x) => x.kind === 'condition' && x.key === c.key && !x.resolvedAt);
      if (a) {
        a.title = c.title; a.detail = c.detail || '';
        if (SEV[c.severity] > SEV[a.severity]) { a.severity = c.severity; a.dismissed = false; added.push(a); } // escalation
        continue;
      }
      if ((this.dismissedUntil.get(c.key) || 0) > now) continue; // dismissed recently: do not nag
      added.push(this._make(now, c, 'condition'));
    }
    for (const a of this.items) if (a.kind === 'condition' && !a.resolvedAt && !keys.has(a.key)) a.resolvedAt = now;
    return added;
  }

  // One-off events (a blocked message, a raised hand). They fade after ttlMs.
  event(now, { key, severity = 'info', title, detail = '', ttlMs = 30_000 }) {
    const dup = this.items.find((x) => x.kind === 'event' && !x.resolvedAt && !x.dismissed && x.title === title && now - x.at < 5000);
    if (dup) return null;
    return this._make(now, { key: key || 'event:' + title, severity, title, detail }, 'event', ttlMs);
  }

  tick(now) { for (const a of this.items) if (a.kind === 'event' && !a.resolvedAt && a.expiresAt && now >= a.expiresAt) a.resolvedAt = now; }

  dismiss(id, now) {
    const a = this.items.find((x) => x.id === id); if (!a) return;
    a.dismissed = true;
    if (a.kind === 'event') a.resolvedAt ??= now; else this.dismissedUntil.set(a.key, now + this.cooldownMs);
  }
  clearAll(now) { for (const a of this.active()) this.dismiss(a.id, now); }

  active() { return this.items.filter((a) => !a.resolvedAt && !a.dismissed).sort((x, y) => SEV[y.severity] - SEV[x.severity] || y.at - x.at); }
  history() { return this.items.filter((a) => a.resolvedAt || a.dismissed).sort((x, y) => (y.resolvedAt || y.at) - (x.resolvedAt || x.at)); }

  toCSV(fmt = (ms) => new Date(ms).toLocaleTimeString()) {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [...this.items].sort((a, b) => a.at - b.at).map((a) =>
      [fmt(a.at), a.severity, a.title, a.detail, a.resolvedAt ? fmt(a.resolvedAt) : '', a.dismissed ? 'yes' : ''].map(cell).join(','));
    return ['Time,Severity,Alert,Detail,Ended,Dismissed by host', ...rows].join('\n');
  }
}

// Turn the host's current view of the class into the list of alerts that should exist right now.
// v = hostView() result; people = { uid: { absentForMs } }; pulseHits = [{ type, n }]
export function buildConditions({ v, people, pulseHits = [], nameOf }) {
  const out = [];
  if (v.focusAlert) {
    out.push({ key: 'class-focus', severity: 'urgent', title: 'Class focus dropped', detail: 'More than half the class looks away or disengaged.' });
  }
  const spoofed = v.flaggedStreams || [];
  if (spoofed.length > 2) out.push({ key: 'spoof-many', severity: 'urgent', title: `${spoofed.length} cameras look frozen or looped`, detail: spoofed.map(nameOf).join(', ') });
  else for (const u of spoofed) out.push({ key: 'spoof:' + u, severity: 'urgent', title: `${nameOf(u)}: camera looks frozen or looped`, detail: 'The video may be a still image or a repeating clip.' });

  if (!v.focusAlert) { // when the whole class dropped, one class alert is enough
    const away = (v.alertable || []).filter((u) => !spoofed.includes(u));
    if (away.length >= 3) out.push({ key: 'away-many', severity: 'attention', title: `${away.length} people have been away a while`, detail: away.map(nameOf).join(', ') });
    else for (const u of away) out.push({ key: 'away:' + u, severity: 'attention', title: `${nameOf(u)} is away`, detail: `Away for ${fmtDur(people[u]?.absentForMs ?? 0)} with no response.` });
  }
  for (const { type, n } of pulseHits) out.push({ key: 'pulse:' + type, severity: 'attention', title: `${n} said "${type}"`, detail: 'Anonymous signals from the class in the last 2 minutes.' });
  return out;
}
