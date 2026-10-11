// Lecture-mode screens: class settings (host), my settings (everyone), questions, speaking queue, accessibility.
// Loaded separately so the call keeps working if this file fails.
import { SpeakQueue, QuestionBox, ALL_PANELS, cleanQuestions } from './lectureCore.js';
import { checkMessage } from './moderation.js';

const PREF_KEY = 'ms-prefs';

export function createLecture(ctx) {
  const { $, esc, toast, me, isHost, members, send, getSettings, setSettings, setRevealed, event } = ctx;
  const queue = new SpeakQueue(), box = new QuestionBox();
  let started = false, requested = false, lastAsk = 0, qTimer = null, items = [], floorList = [], lastSize = -1;
  const voted = new Set();
  const toggle = (id) => { const el = $(id), show = el.hidden; ALL_PANELS.forEach((p) => { if ($(p)) $(p).hidden = true; }); el.hidden = !show; return show; };

  // ---------- accessibility preferences ----------
  let prefs = { fs: 1, contrast: false, motion: false };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch {}
  try { if (!localStorage.getItem(PREF_KEY) && window.matchMedia('(prefers-reduced-motion: reduce)').matches) prefs.motion = true; } catch {}
  function applyPrefs() {
    const r = document.documentElement;
    r.style.setProperty('--fs', String(prefs.fs));
    r.dataset.contrast = prefs.contrast ? 'high' : ''; r.dataset.motion = prefs.motion ? 'reduced' : '';
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
    $('sContrast').checked = prefs.contrast; $('sMotion').checked = prefs.motion;
  }

  // ---------- questions (anonymous) ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function renderQA() {
    const list = isHost ? box.sorted() : items;
    $('qaList').innerHTML = list.length ? list.map((q) =>
      `<div class="qa${q.answered ? ' done' : ''}"><div>${esc(q.text)}<small>${q.votes} vote${q.votes === 1 ? '' : 's'}${q.answered ? ' · answered' : ''}</small></div><div>` +
      (q.answered ? '' : `<button class="ghost" data-up="${esc(q.id)}"${voted.has(q.id) ? ' disabled' : ''}>▲ ${q.votes}</button>`) +
      (isHost ? `<button class="ghost" data-ans="${esc(q.id)}">${q.answered ? 'Undo' : 'Answered'}</button><button class="ghost" data-hide="${esc(q.id)}">Hide</button>` : '') +
      '</div></div>').join('') : '<p class="mut">No questions yet.</p>';
  }
  function syncQuestionsSoon() { // host is the single source of truth; everyone else just displays it
    if (!isHost || qTimer) return;
    qTimer = setTimeout(() => { qTimer = null; send('qsync', { items: box.toJSON() }); }, 250);
  }
  function askQuestion() {
    const s = getSettings(), text = $('qaInput').value.trim();
    if (!s.questions) return toast('The host turned questions off.');
    if (!text) return;
    if (Date.now() - lastAsk < 20000) return toast('Please wait a few seconds before asking another question.');
    if (checkMessage(text).blocked) return toast('Question not sent: please keep it respectful.');
    lastAsk = Date.now(); $('qaInput').value = '';
    send('ask', { id: newId(), text }); // no name or id of the sender is sent: it is anonymous
    toast('Question sent anonymously.');
  }

  // ---------- speaking queue ----------
  const broadcastQueue = () => send('queue', { list: queue.list.map(({ uid, name }) => ({ uid, name })) });
  function renderQueue() {
    if (!isHost) return;
    const s = getSettings(), nameOf = (u) => members.get(u)?.username || 'Someone';
    $('queueBox').innerHTML =
      (s.speaker ? `<div class="qa"><div><b>${esc(nameOf(s.speaker))}</b> has the floor</div><button id="endTurn">End turn</button></div>` : '') +
      (queue.list.length ? queue.list.map((x, i) => `<div class="qa"><div>#${i + 1} ${esc(x.name)}</div><div><button data-give="${esc(x.uid)}">Let speak</button><button class="ghost" data-drop="${esc(x.uid)}">Remove</button></div></div>`).join('')
        : '<p class="mut">Nobody is waiting to speak.</p>');
  }
  function renderFloorNote() {
    const s = getSettings(), pos = floorList.findIndex((x) => x.uid === me.id), n = $('floorNote');
    const t = s.speaker === me.id ? 'It is your turn to speak.' : pos >= 0 ? `You are #${pos + 1} in the speaking queue.` : '';
    n.hidden = !t; n.textContent = t;
  }
  function syncSpeakButtons() {
    document.querySelectorAll('[data-speak]').forEach((b) => (b.textContent = requested ? 'Cancel request to speak' : 'Request to speak'));
  }
  function toggleRequest() {
    requested = !requested; syncSpeakButtons();
    send('speakreq', { uid: me.id, name: me.username, up: requested });
    toast(requested ? 'Request sent. The host will call you.' : 'Request cancelled.');
  }
  const giveFloor = (uid) => { queue.remove(uid); setSettings({ speaker: uid }); broadcastQueue(); renderQueue(); };

  // ---------- incoming events ----------
  const onAsk = (p) => {
    if (!isHost || !getSettings().questions || !p?.id) return;
    if (box.add({ id: String(p.id).slice(0, 40), text: p.text })) {
      event?.({ key: 'q:' + p.id, severity: 'info', title: 'New anonymous question', detail: String(p.text).slice(0, 80), ttlMs: 90000 });
    }
    syncQuestionsSoon(); renderQA();
  };
  const onUpvote = (p) => { if (!isHost) return; box.vote(p?.id); syncQuestionsSoon(); renderQA(); };
  const onQsync = (p) => { if (isHost) return; items = cleanQuestions(p?.items); renderQA(); };
  const onSpeakReq = (p) => {
    if (!isHost || !p?.uid) return;
    if (p.up) { queue.add(p.uid, p.name, Date.now()); event?.({ key: 'speak:' + p.uid, severity: 'info', title: `${p.name} wants to speak`, ttlMs: 120000 }); }
    else queue.remove(p.uid);
    broadcastQueue(); renderQueue();
  };
  const onQueue = (p) => { if (isHost) return; floorList = Array.isArray(p?.list) ? p.list.slice(0, 100) : []; renderFloorNote(); };

  return {
    attach(channel) {
      channel
        .on('broadcast', { event: 'ask' }, ({ payload }) => onAsk(payload))
        .on('broadcast', { event: 'upvote' }, ({ payload }) => onUpvote(payload))
        .on('broadcast', { event: 'qsync' }, ({ payload }) => onQsync(payload))
        .on('broadcast', { event: 'speakreq' }, ({ payload }) => onSpeakReq(payload))
        .on('broadcast', { event: 'queue' }, ({ payload }) => onQueue(payload));
    },
    snapshot() { return { questions: [...box.items.values()] }; }, // used by the session summary
    // called when the host's settings change (or when we first learn them)
    onSettings(s) {
      $('sMode').value = s.mode; $('sChat').value = s.perms.chat; $('sUnmute').value = s.perms.unmute; $('sQ').checked = s.questions;
      $('revealRow').hidden = !(s.mode === 'reveal' && !isHost);
      if (s.mode !== 'reveal' && $('sReveal').checked) { $('sReveal').checked = false; setRevealed(false); }
      $('qaInput').disabled = !s.questions; $('qaSend').disabled = !s.questions;
      $('qaNote').textContent = s.questions ? 'Questions are anonymous: your name is not sent with them.' : 'The host turned questions off.';
      if (s.speaker === me.id) { requested = false; syncSpeakButtons(); }
      renderFloorNote(); renderQueue();
    },
    // called when people join or leave: the host re-sends the current state so late joiners are up to date
    onMembers() {
      if (!isHost || members.size === lastSize) return;
      lastSize = members.size; broadcastQueue(); syncQuestionsSoon();
    },
    start() {
      if (started) return; started = true;
      applyPrefs(); renderQA(); renderQueue(); syncSpeakButtons();
      document.querySelectorAll('.rb').forEach((b) => b.title && b.setAttribute('aria-label', b.title)); // screen-reader names
      $('setBtn').onclick = () => toggle('mySettings');
      $('qaBtn').onclick = () => { if (toggle('qaPanel')) { renderQA(); renderQueue(); } };
      $('fsDown').onclick = () => { prefs.fs = Math.max(0.8, Math.round((prefs.fs - 0.1) * 10) / 10); applyPrefs(); };
      $('fsUp').onclick = () => { prefs.fs = Math.min(1.6, Math.round((prefs.fs + 0.1) * 10) / 10); applyPrefs(); };
      $('fsReset').onclick = () => { prefs.fs = 1; applyPrefs(); };
      $('sContrast').onchange = () => { prefs.contrast = $('sContrast').checked; applyPrefs(); };
      $('sMotion').onchange = () => { prefs.motion = $('sMotion').checked; applyPrefs(); };
      $('sReveal').onchange = () => setRevealed($('sReveal').checked);
      $('qaSend').onclick = askQuestion;
      $('qaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') askQuestion(); });
      document.querySelectorAll('[data-speak]').forEach((b) => (b.onclick = () => { const r = $('reactPanel'); if (r) r.hidden = true; toggleRequest(); }));
      $('qaList').onclick = (e) => {
        const d = e.target.dataset || {};
        if (d.up && !voted.has(d.up)) { voted.add(d.up); send('upvote', { id: d.up }); renderQA(); }
        if (!isHost) return;
        if (d.ans) { box.toggleAnswered(d.ans); syncQuestionsSoon(); renderQA(); }
        if (d.hide) { box.hide(d.hide); syncQuestionsSoon(); renderQA(); }
      };
      if (isHost) {
        $('hostSetBtn').onclick = () => toggle('hostSettings');
        $('sMode').onchange = () => setSettings({ mode: $('sMode').value });
        $('sChat').onchange = () => setSettings({ perms: { chat: $('sChat').value } });
        $('sUnmute').onchange = () => setSettings({ perms: { unmute: $('sUnmute').value } });
        $('sQ').onchange = () => setSettings({ questions: $('sQ').checked });
        $('queueBox').onclick = (e) => {
          const d = e.target.dataset || {};
          if (d.give) giveFloor(d.give);
          if (d.drop) { queue.remove(d.drop); broadcastQueue(); renderQueue(); }
          if (e.target.id === 'endTurn') { setSettings({ speaker: null }); renderQueue(); }
        };
      }
      // keyboard shortcuts (not while typing): m mic, v camera, c chat, q questions, s settings, Esc closes panels
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
        const k = e.key.toLowerCase(), click = (id) => { e.preventDefault(); $(id).click(); };
        if (k === 'm') click('mic'); else if (k === 'v') click('cam'); else if (k === 'c') click('chatBtn');
        else if (k === 'q') click('qaBtn'); else if (k === 's') click('setBtn');
        else if (e.key === 'Escape') ALL_PANELS.forEach((p) => { if ($(p)) $(p).hidden = true; });
      });
    },
  };
}
