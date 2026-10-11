// Extra meeting features. Loaded separately: if this file fails, the call still works.
import { Attendance } from './featuresCore.js';
import { addWords } from './moderation.js';
import { AlertFeed, buildConditions, fmtDur } from './alertsCore.js';

const FRIENDLY = { engaged: 'Engaged', active_secondary: 'Working on something else', passive_absent: 'Away',
  spoof_suspect: 'Camera looks frozen or looped', excused: 'Be right back' };
const PANELS = ['chatPanel', 'hostPanel', 'seesPanel', 'reportPanel', 'alertsPanel'];
const EMOJIS = ['👍', '👏', '❤️', '😂', '🎉'];

export function createFeatures(ctx) {
  const { $, esc, toast, me, meeting, isHost, members, states, send, getSelf } = ctx;
  const att = new Attendance();
  let poll = null, handUp = false, started = false, lastReact = 0, words = [], lastMemberCount = -1;
  const voted = new Set();

  // ---------- 6. Host alert feed ----------
  const feed = new AlertFeed();
  let soundOn = true, actx = null;
  try { soundOn = localStorage.getItem('ms-alert-sound') !== 'off'; } catch {}
  try { document.addEventListener('pointerdown', () => { try { actx?.resume(); } catch {} }); } catch {}
  function beep(freq) {
    if (!soundOn) return;
    try {
      actx ??= new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(); o.stop(t + 0.4);
    } catch {}
  }
  function notify(added) {
    if (!added.length) return;
    try {
      if (added.some((a) => a.severity === 'urgent')) { beep(880); navigator.vibrate?.([200, 100, 200]); }
      else if (added.some((a) => a.severity === 'attention')) { beep(660); navigator.vibrate?.(150); }
    } catch {}
  }
  function renderAlerts() {
    const act = feed.active(), now = Date.now();
    $('alertBadge').hidden = !act.length; $('alertBadge').textContent = act.length;
    const bar = $('alertbar');
    if (act.length) {
      const top = act[0]; bar.hidden = false; bar.className = 'sev-' + top.severity;
      bar.innerHTML = `<b>${esc(top.title)}</b>${top.detail ? ' · ' + esc(top.detail) : ''}${act.length > 1 ? ` <u>(+${act.length - 1} more)</u>` : ''}`;
    } else bar.hidden = true;
    if ($('alertsPanel').hidden) return;
    const item = (a, past) => `<div class="al sev-${a.severity}${past ? ' past' : ''}"><div><b>${esc(a.title)}</b><small>${esc(a.detail)}${a.detail ? ' · ' : ''}${fmtDur(now - a.at)} ago${past && a.resolvedAt ? ' · ended' : ''}</small></div>${past ? '' : `<button class="ghost" data-dismiss="${a.id}">✕</button>`}</div>`;
    $('alertsList').innerHTML = act.length ? act.map((a) => item(a, false)).join('') : '<p class="mut">No active alerts. Everything looks fine.</p>';
    const hist = feed.history().slice(0, 25);
    $('alertsHistory').innerHTML = hist.length ? hist.map((a) => item(a, true)).join('') : '<p class="mut">Nothing yet.</p>';
    $('alertsSound').textContent = soundOn ? 'Sound: on' : 'Sound: off';
  }
  const hostEvent = (e) => { if (!isHost) return; const a = feed.event(Date.now(), e); if (a) notify([a]); renderAlerts(); };
  function downloadText(name, text, type = 'text/csv') {
    const blob = new Blob([text], { type }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  const togglePanel = (id) => { const el = $(id), show = el.hidden; PANELS.forEach((p) => { if ($(p)) $(p).hidden = true; }); el.hidden = !show; return show; };

  // ---------- 1. What MeetSentra sees about you ----------
  function renderSees() {
    const s = getSelf(), yn = (v) => (v ? '<span class="yes">Yes</span>' : '<span class="no">No</span>');
    const row = (k, v) => `<div class="sees"><span>${k}</span><b>${v}</b></div>`;
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    $('seesBody').innerHTML =
      row('Your camera is shared with others', yn(s.camShared)) +
      row('Camera used on this device for the engagement check', s.focusActive ? '<span class="yes">Yes</span>' : 'Off') +
      row('Face detected right now', s.focusActive ? yn(s.faceNow) : 'Off') +
      row('Meeting window in focus', yn(focused)) +
      row('Microphone active (loudness only)', yn(Date.now() - s.micAt < 3000)) +
      row('Status the host sees', esc(FRIENDLY[s.state] || (s.focusActive ? 'Starting...' : 'Nothing: check is off'))) +
      (s.reasons?.length ? `<p class="mut">Why: ${esc(s.reasons.join('; '))}</p>` : '') +
      '<p class="mut"><b>Only the status above is sent.</b> Your video, audio, screen, and other windows are never sent or stored by this check.</p>';
  }

  // ---------- 2. Attendance and engagement report (host) ----------
  const chart = () => {
    const t = att.timeline;
    if (t.length < 2) return '<p class="mut">The timeline appears after about a minute (one point every 30 seconds).</p>';
    const W = 300, H = 90;
    const pts = t.map((p, i) => `${((i / (t.length - 1)) * W).toFixed(1)},${(H - (p.pct * H) / 100).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#0b1426;border-radius:8px"><polyline fill="none" stroke="#4f8cff" stroke-width="2" points="${pts}"/></svg>
      <div class="mut">Share of the class engaged or working over time (0 to 100%)</div>`;
  };
  function renderReport() {
    const rows = att.rows();
    $('reportBody').innerHTML = (rows.length ? `<table class="tbl"><tr><th>Name</th><th>Joined</th><th>Min</th><th>Engaged</th><th>Away</th></tr>` +
      rows.map((r) => `<tr><td>${esc(r.name)}${r.present ? '' : ' (left)'}</td><td>${new Date(r.firstSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${r.totalMin}</td><td>${r.engagedPct ?? '-'}${r.engagedPct === null ? '' : '%'}</td><td>${r.awayMin}</td></tr>`).join('') + '</table>'
      : '<p class="mut">No data yet. It fills in while people are in the meeting.</p>') +
      chart() + '<button id="csvBtn">Download CSV</button><p class="mut">Estimates from on-device checks. Please do not use them for grading or discipline.</p>';
    const b = $('csvBtn'); if (b) b.onclick = downloadCSV;
  }
  function downloadCSV() { downloadText(`meetsentra-attendance-${meeting.title.replace(/[^a-z0-9]+/gi, '-')}.csv`, att.toCSV()); }

  // ---------- 3. Polls and understanding checks ----------
  function renderPollHost() {
    if (!isHost) return;
    const box = $('pollHost');
    if (!poll) { box.innerHTML = ''; $('pollEnd').hidden = true; return; }
    const total = poll.votes.reduce((a, b) => a + b, 0);
    box.innerHTML = `<b>${esc(poll.q)}</b>` + poll.options.map((o, i) =>
      `<div class="bar"><i style="width:${total ? Math.max(8, Math.round((100 * poll.votes[i]) / total)) : 8}%">${esc(o)}: ${poll.votes[i]}</i></div>`).join('') +
      `<small class="mut">${total} vote${total === 1 ? '' : 's'}${poll.ended ? ' (ended)' : ''}</small>`;
    $('pollEnd').hidden = !!poll.ended;
  }
  function showVoteCard() {
    const c = $('pollCard'); c.hidden = false;
    c.innerHTML = `<b>${esc(poll.q)}</b><div>${poll.options.map((o, i) => `<button data-vote="${i}">${esc(o)}</button>`).join('')}</div>`;
    c.onclick = (e) => {
      const i = e.target.dataset?.vote;
      if (i === undefined || !poll || voted.has(poll.id)) return;
      voted.add(poll.id); send('vote', { id: poll.id, i: Number(i) });
      c.innerHTML = '<b>Thanks. Your answer was sent anonymously.</b>';
      setTimeout(() => { if (poll && !poll.ended) c.hidden = true; }, 2500);
    };
  }
  function startPoll(q, options) {
    options = options.map((o) => o.trim()).filter(Boolean).slice(0, 6);
    if (!q.trim() || options.length < 2) return toast('Add a question and at least 2 options.');
    send('poll', { id: Date.now().toString(36), q: q.trim().slice(0, 140), options: options.map((o) => o.slice(0, 40)) });
  }
  const onPoll = (p) => {
    if (!p?.id || !Array.isArray(p.options)) return;
    poll = { id: p.id, q: String(p.q), options: p.options.map(String), votes: p.options.map(() => 0), ended: false };
    if (isHost) { renderPollHost(); toast('Poll sent.'); } else { showVoteCard(); }
  };
  const onVote = (p) => { if (poll && p.id === poll.id && poll.votes[p.i] !== undefined) { poll.votes[p.i]++; renderPollHost(); } };
  const onPollEnd = (p) => {
    if (!poll || p.id !== poll.id) return;
    poll.ended = true; renderPollHost(); hostEvent({ severity: 'info', title: 'Poll finished', detail: poll.q, ttlMs: 20000 });
    const total = poll.votes.reduce((a, b) => a + b, 0), c = $('pollCard');
    c.hidden = false; c.onclick = null;
    c.innerHTML = `<b>Results: ${esc(poll.q)}</b>` + poll.options.map((o, i) =>
      `<div class="bar"><i style="width:${total ? Math.max(8, Math.round((100 * poll.votes[i]) / total)) : 8}%">${esc(o)}: ${poll.votes[i]}</i></div>`).join('');
    setTimeout(() => { c.hidden = true; }, 12000);
  };

  // ---------- 4. Raise hand and reactions ----------
  const onHand = (p) => {
    const t = $('tile-' + p.uid); if (t) t.dataset.hand = p.up ? '1' : '0';
    if (p.up && p.uid !== me.id) hostEvent({ key: 'hand:' + p.uid, severity: 'info', title: `${p.name} raised a hand`, ttlMs: 60000 });
  };
  const onReact = (p) => {
    if (!EMOJIS.includes(p.emoji)) return;
    const s = document.createElement('span'); s.className = 'fl'; s.textContent = p.emoji;
    s.style.left = 10 + Math.random() * 80 + '%'; $('floaters').appendChild(s); setTimeout(() => s.remove(), 2500);
  };

  // ---------- 5. Host-defined blocked words ----------
  const broadcastWords = () => { if (isHost && words.length) send('words', { list: words }); };

  return {
    onHostView({ v, people, pulseHits, nameOf }) {
      if (!isHost) return;
      const added = feed.sync(Date.now(), buildConditions({ v, people, pulseHits, nameOf }));
      feed.tick(Date.now()); notify(added); renderAlerts();
    },
    event: hostEvent,
    attach(channel) {
      channel
        .on('broadcast', { event: 'poll' }, ({ payload }) => onPoll(payload))
        .on('broadcast', { event: 'vote' }, ({ payload }) => onVote(payload))
        .on('broadcast', { event: 'pollend' }, ({ payload }) => onPollEnd(payload))
        .on('broadcast', { event: 'hand' }, ({ payload }) => onHand(payload))
        .on('broadcast', { event: 'react' }, ({ payload }) => onReact(payload))
        .on('broadcast', { event: 'words' }, ({ payload }) => addWords(Array.isArray(payload?.list) ? payload.list.slice(0, 200) : []));
    },
    start() {
      if (started) return; started = true;
      $('seesBtn').onclick = () => { if (togglePanel('seesPanel')) renderSees(); };
      document.querySelectorAll('[data-emoji]').forEach((b) => (b.onclick = () => {
        $('reactPanel').hidden = true;
        const e = b.dataset.emoji;
        if (e === 'hand') { handUp = !handUp; send('hand', { uid: me.id, name: me.username, up: handUp }); toast(handUp ? 'Hand raised' : 'Hand lowered'); }
        else if (Date.now() - lastReact > 800) { lastReact = Date.now(); send('react', { uid: me.id, emoji: e }); }
      }));
      setInterval(() => { if (!$('seesPanel').hidden) renderSees(); }, 1000);
      if (!isHost) return;
      $('alertsBtn').onclick = () => { if (togglePanel('alertsPanel')) renderAlerts(); };
      $('alertbar').onclick = () => { if ($('alertsPanel').hidden) { togglePanel('alertsPanel'); renderAlerts(); } };
      $('alertsList').onclick = (e) => { const id = e.target.dataset?.dismiss; if (id) { feed.dismiss(Number(id), Date.now()); renderAlerts(); } };
      $('alertsClear').onclick = () => { feed.clearAll(Date.now()); renderAlerts(); };
      $('alertsSound').onclick = () => { soundOn = !soundOn; try { localStorage.setItem('ms-alert-sound', soundOn ? 'on' : 'off'); } catch {} renderAlerts(); if (soundOn) beep(660); };
      $('alertsCsv').onclick = () => downloadText(`meetsentra-alerts-${meeting.title.replace(/[^a-z0-9]+/gi, '-')}.csv`, feed.toCSV());
      setInterval(() => { feed.tick(Date.now()); renderAlerts(); }, 1000);
      $('reportBtn').onclick = () => { if (togglePanel('reportPanel')) renderReport(); };
      $('pollSend').onclick = () => startPoll($('pollQ').value, $('pollOpts').value.split(','));
      $('pollQuick').onclick = () => startPoll('Did you understand this?', ['Yes', 'Somewhat', 'No']);
      $('pollEnd').onclick = () => { if (poll) send('pollend', { id: poll.id }); };
      $('wordsSend').onclick = () => {
        const list = $('wordsIn').value.split(',').map((w) => w.trim()).filter(Boolean);
        if (!list.length) return;
        words = [...new Set([...words, ...list])]; $('wordsIn').value = ''; broadcastWords(); toast(`Added ${list.length} word(s) to the class filter.`);
      };
      setInterval(() => {
        const list = [...members].filter(([u]) => u !== me.id).map(([u, i]) => ({ uid: u, name: i.username }));
        att.sample(Date.now(), list, (u) => states.get(u)?.state, 5);
        if (!$('reportPanel').hidden) renderReport();
        if (members.size !== lastMemberCount) { lastMemberCount = members.size; broadcastWords(); } // new joiners get the word list
        if (Math.round(Date.now() / 1000) % 30 < 5) { try { localStorage.setItem('ms-report-' + meeting.id, JSON.stringify({ savedAt: Date.now(), rows: att.rows(), timeline: att.timeline })); } catch {} }
      }, 5000);
    },
  };
}
