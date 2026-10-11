import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { checkMessage } from './moderation.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const meetingId = new URLSearchParams(location.search).get('m');

let me, meeting, isHost, localStream, rawStream, peer, channel, runtime = null, eng = null, ac = null, focusActive = false, focusConsent = false;
let muted = false, lastState = null, brbOn = false, lastPulse = 0, unread = 0, joinedAt = Date.now();
const members = new Map(), states = new Map(), calls = new Map(), strikes = new Map();
let pulses = [];

const FRIENDLY = { engaged: 'Engaged', active_secondary: 'Working on something else', passive_absent: 'Away',
  spoof_suspect: 'Camera looks frozen or looped', excused: 'Be right back' };

function toast(t) {
  const el = $('mtoast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 4000);
}
function watchLevel(stream, cb) {
  if (!stream.getAudioTracks().length) return;
  try {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; cb(Math.sqrt(s / buf.length)); }, 150);
  } catch {}
}
document.addEventListener('pointerdown', () => ac?.resume());
const setIcon = (btn, id) => btn.querySelector('use').setAttribute('href', '#' + id);
const nameOf = (uid) => members.get(uid)?.username || uid.slice(0, 6);

// ---------- start ----------
async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { location.href = 'index.html'; return; }
  const { data: prof } = await sb.from('profiles').select('id,username').eq('id', user.id).single();
  me = prof;
  const { data: m } = await sb.from('meetings').select('id,title,duration_min,room_code,started_at,host_id').eq('id', meetingId).maybeSingle();
  if (!m) { $('status').textContent = 'You are not invited to this meeting, or it does not exist.'; $('status').classList.add('err'); return; }
  meeting = m; isHost = m.host_id === me.id;
  const { data: h } = await sb.from('profiles').select('username').eq('id', m.host_id).maybeSingle();
  $('lobbyTitle').textContent = m.title;
  $('lobbyHost').textContent = `Hosted by ${h?.username || 'the host'} · ${m.duration_min} min`;
  $('status').hidden = true; $('lobby').hidden = false;
  await startPreview();
  $('joinBtn').onclick = join;
  loadEngine();
}

async function loadEngine() { // the call still works if these files are missing
  try { eng = { ...(await import('./engagementEngine.js')), ...(await import('./clientSignals.js')) }; }
  catch { eng = null; }
}

async function startPreview() {
  const tries = [{ video: true, audio: true }, { video: true }, { audio: true }];
  rawStream = null;
  for (const c of tries) { try { rawStream = await navigator.mediaDevices.getUserMedia(c); break; } catch {} }
  if (!rawStream) rawStream = new MediaStream();
  // What we SHARE = microphone + a clone of the camera. Switching sharing off disables only the clone,
  // so the original camera track stays available for the consented, on-device engagement check.
  localStream = new MediaStream([...rawStream.getAudioTracks(), ...rawStream.getVideoTracks().map((t) => t.clone())]);
  $('preview').srcObject = localStream;
  const notes = [];
  if (!rawStream.getAudioTracks().length) notes.push('Microphone not available. Allow microphone access in your browser site settings, then reload.');
  if (!rawStream.getVideoTracks().length) notes.push('Camera not available.');
  $('lobbyNote').textContent = notes.join(' ');
  watchLevel(localStream, (lvl) => { $('meter').style.width = Math.min(100, lvl * 500) + '%'; });
  syncIcons();
}

function toggleTrack(kind) {
  if (kind === 'audio') {
    const tracks = localStream.getAudioTracks();
    if (muted) return toast('The host muted you.');
    if (!tracks.length) return toast('No microphone available. Allow it in browser site settings and reload.');
    const on = !tracks[0].enabled; tracks.forEach((t) => (t.enabled = on));
  } else {
    const v = localStream.getVideoTracks()[0];
    if (!v) return toast('No camera available.');
    const on = !v.enabled; v.enabled = on;                                  // sharing on/off
    const consent = focusActive ? focusConsent : $('focusOpt').checked;
    if (!consent) rawStream.getVideoTracks().forEach((t) => (t.enabled = on)); // no consent: camera really off
  }
  syncIcons(); updatePrivacy();
}
function updatePrivacy() {
  const p = $('privacy'); p.hidden = !focusActive;
  p.textContent = localStream.getVideoTracks()[0]?.enabled ? 'Engagement estimate on' : 'Engagement check on · camera not shared';
}

function syncIcons() {
  const a = localStream.getAudioTracks()[0], v = localStream.getVideoTracks()[0];
  const micOff = !a || !a.enabled, camOff = !v || !v.enabled;
  for (const id of ['pMic', 'mic']) { $(id).classList.toggle('off', micOff); setIcon($(id), micOff ? 'i-mic-off' : 'i-mic'); }
  for (const id of ['pCam', 'cam']) { $(id).classList.toggle('off', camOff); setIcon($(id), camOff ? 'i-cam-off' : 'i-cam'); }
}
$('pMic').onclick = $('mic').onclick = () => toggleTrack('audio');
$('pCam').onclick = $('cam').onclick = () => toggleTrack('video');

async function join() {
  const wantsFocus = $('focusOpt').checked && rawStream.getVideoTracks().length > 0;
  focusConsent = wantsFocus;
  $('analysis').srcObject = new MediaStream(rawStream.getVideoTracks()); // used only on this device
  $('lobby').hidden = true; $('room').hidden = false;
  $('roomTitle').textContent = meeting.title;
  $('hostBtn').hidden = !isHost;
  addTile(me.id, `${me.username} (you)`, localStream, true);
  syncIcons();
  if (!isHost) sb.from('invites').update({ joined_at: new Date().toISOString() }).eq('meeting_id', meeting.id).eq('user_id', me.id).then(() => {});

  peer = new Peer('ms-' + me.id);
  peer.on('call', async (call) => {
    if (!(await waitKnown(call.peer))) return call.close(); // only answer people who are in this room
    call.answer(localStream); wireCall(call);
  });
  peer.on('open', () => openChannel(wantsFocus));
  peer.on('error', (e) => toast('Video connection issue: ' + e.type));
  setInterval(tickClock, 1000); tickClock();
}

function tickClock() {
  const start = meeting.started_at ? Date.parse(meeting.started_at) : joinedAt;
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  $('clock').textContent = `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  $('count').textContent = `${Math.max(1, members.size)} in meeting`;
}

const waitKnown = async (peerId) => {
  for (let i = 0; i < 20; i++) {
    if ([...members.values()].some((m) => m.peerId === peerId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

// ---------- video tiles ----------
const updateGrid = () => { $('videos').dataset.n = Math.min(9, Math.max(1, document.querySelectorAll('.tile').length)); };
function addTile(uid, label, stream, self) {
  let t = $('tile-' + uid);
  if (!t) {
    t = document.createElement('div'); t.className = 'tile' + (self ? ' self' : ''); t.id = 'tile-' + uid;
    t.innerHTML = '<video autoplay playsinline></video><span class="nm"></span>';
    $('videos').appendChild(t);
  }
  const v = t.querySelector('video'); v.srcObject = stream; v.muted = !!self;
  if (!self) v.play?.().catch(() => { $('audioBanner').hidden = false; });
  if (!t._lvl) { t._lvl = true; watchLevel(stream, (lvl) => t.classList.toggle('speaking', lvl > 0.04)); }
  t.querySelector('.nm').textContent = label; updateGrid();
}
const removeTile = (uid) => { $('tile-' + uid)?.remove(); updateGrid(); };
function wireCall(call) {
  const uid = call.peer.slice(3);
  calls.set(uid, call);
  call.on('stream', (s) => addTile(uid, nameOf(uid), s, false));
  call.on('close', () => removeTile(uid));
}

// ---------- room channel ----------
function openChannel(wantsFocus) {
  channel = sb.channel('room:' + meeting.room_code, { config: { presence: { key: me.id }, broadcast: { self: true } } });
  channel
    .on('presence', { event: 'sync' }, syncMembers)
    .on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'pulse' }, ({ payload }) => { pulses.push({ t: Date.now(), type: payload.type }); renderHost(); })
    .on('broadcast', { event: 'flag' }, ({ payload }) => onFlag(payload))
    .on('broadcast', { event: 'mod' }, ({ payload }) => onMod(payload))
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track({ username: me.username, peerId: 'ms-' + me.id, joinedAt: Date.now(), host: isHost });
      if (wantsFocus) startFocus(); else toast('Engagement estimation is off for you.');
    });
}

function syncMembers() {
  const st = channel.presenceState(), next = new Map();
  for (const [uid, arr] of Object.entries(st)) next.set(uid, arr[0]);
  for (const uid of [...members.keys()]) if (!next.has(uid)) { calls.get(uid)?.close(); calls.delete(uid); removeTile(uid); states.delete(uid); }
  members.clear(); next.forEach((v, k) => members.set(k, v));
  if (localStream?.getTracks().length) {
    for (const [uid, info] of members) {
      if (uid !== me.id && !calls.has(uid) && me.id < uid) wireCall(peer.call(info.peerId, localStream)); // lower id calls: no double calls
    }
  }
  tickClock(); renderHost();
}

// ---------- chat + moderation ----------
function onChat(p) {
  const d = document.createElement('p');
  d.innerHTML = `<b>${esc(p.username)}</b><br>${esc(p.text)}`;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight;
  if ($('chatPanel').hidden && p.uid !== me.id) { unread++; $('chatBadge').textContent = unread; $('chatBadge').hidden = false; }
}
$('send').onclick = () => {
  const text = $('msg').value.trim(); if (!text) return;
  if (muted) return toast('The host has muted you.');
  const r = checkMessage(text);
  if (r.blocked) {
    toast('Message blocked: please keep the chat respectful.');
    channel.send({ type: 'broadcast', event: 'flag', payload: { uid: me.id, username: me.username } });
  } else {
    channel.send({ type: 'broadcast', event: 'chat', payload: { uid: me.id, username: me.username, text } });
    runtime?.noteChat();
  }
  $('msg').value = '';
};
$('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('send').click(); });

function onFlag(p) {
  if (!isHost) return;
  const n = (strikes.get(p.uid) || 0) + 1; strikes.set(p.uid, n);
  toast(`${p.username}'s message was blocked (${n}).`);
  if (n >= 3) { strikes.set(p.uid, 0); sendMod('mute', p.uid); }
}
const sendMod = (action, target) => channel.send({ type: 'broadcast', event: 'mod', payload: { action, target, from: me.id } });
function onMod(p) {
  // Prototype only: a determined invited user could forge this. Real enforcement needs a server.
  if (p.target !== me.id || p.from !== meeting.host_id) return;
  if (p.action === 'mute') { muted = true; localStream.getAudioTracks().forEach((t) => (t.enabled = false)); syncIcons(); toast('The host muted you.'); }
  else if (p.action === 'remove') { alert('You were removed from this meeting by the host.'); location.href = 'index.html'; }
}

// ---------- engagement (on-device) ----------
async function loadDetector() {
  const { FaceDetector, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
    runningMode: 'VIDEO',
  });
}
async function startFocus() {
  if (!eng) { await loadEngine(); }
  if (!eng) return toast('Engagement files are missing, but video and chat still work.');
  const video = $('analysis');
  let det;
  try { det = await loadDetector(); } catch (e) { return toast('Engagement estimation could not start: ' + e.message); }
  let faceNow = true, last = null, lastLiveAt = Date.now();
  setInterval(() => {
    if (video.readyState < 2) return;
    const d = det.detectForVideo(video, performance.now()).detections[0];
    faceNow = !!d;
    if (d) { // tiny natural movement of the face box = a live person (a still photo has none)
      const b = d.boundingBox, cur = [b.originX, b.originY, b.width];
      if (last && cur.some((v, i) => Math.abs(v - last[i]) > 1.5)) lastLiveAt = Date.now();
      last = cur;
    }
  }, 500);
  runtime = eng.createEngagementRuntime({
    videoEl: video,
    micStream: localStream.getAudioTracks().length ? localStream : null,
    getFaceState: () => ({ facePresent: faceNow, gazeOnScreen: null, livenessRecent: Date.now() - lastLiveAt < 8000 }),
    onStateChange: (s) => sendState(s),
    onPulsePrompt: () => { $('prompt').hidden = false; },
    workerUrl: new URL('./spoofWorker.js', location.href),
  });
  $('brb').hidden = false; focusActive = true; updatePrivacy();
  setInterval(() => lastState && sendState(lastState), 10000); // heartbeat
  toast('Engagement estimation is on (this device only).');
}
const sendState = (s) => { lastState = s; channel.send({ type: 'broadcast', event: 'state', payload: { uid: me.id, state: s.state, reasons: s.reasons } }); };
function onState(p) {
  const prev = states.get(p.uid);
  states.set(p.uid, { state: p.state, reasons: p.reasons, since: prev && prev.state === p.state ? prev.since : Date.now() });
  renderHost();
}

// ---------- buttons and panels ----------
$('audioBanner').onclick = () => { document.querySelectorAll('#videos video').forEach((v) => v.play?.()); ac?.resume(); $('audioBanner').hidden = true; };
$('here').onclick = () => { runtime?.noteReaction(); $('prompt').hidden = true; };
$('brb').onclick = () => {
  brbOn = !brbOn; brbOn ? runtime?.excuse() : runtime?.cancelExcuse();
  $('brb').classList.toggle('on', brbOn); toast(brbOn ? 'Marked as away for up to 10 minutes.' : 'Welcome back!');
};
const toggle = (id) => { const el = $(id); el.hidden = !el.hidden; return !el.hidden; };
$('chatBtn').onclick = () => { $('hostPanel').hidden = true; if (toggle('chatPanel')) { unread = 0; $('chatBadge').hidden = true; } };
$('hostBtn').onclick = () => { $('chatPanel').hidden = true; toggle('hostPanel'); renderHost(); };
$('reactBtn').onclick = () => toggle('reactPanel');
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => ($(b.dataset.close).hidden = true)));
document.querySelectorAll('.pulse').forEach((b) => (b.onclick = () => {
  $('reactPanel').hidden = true;
  if (Date.now() - lastPulse < 120000) return toast('You already sent a signal in the last 2 minutes.');
  lastPulse = Date.now(); runtime?.noteReaction();
  channel.send({ type: 'broadcast', event: 'pulse', payload: { type: b.dataset.type } });
  toast(`Sent "${b.dataset.type}" to the host (anonymous).`);
}));
$('leave').onclick = () => { if (confirm('Leave this meeting?')) location.href = 'index.html'; };

// ---------- host panel ----------
function renderHost() {
  if (!isHost || !channel) return;
  const now = Date.now(), lines = [];
  const recent = pulses.filter((p) => now - p.t < 120000), counts = {};
  recent.forEach((p) => (counts[p.type] = (counts[p.type] || 0) + 1));
  for (const [type, n] of Object.entries(counts)) if (n >= Math.max(1, Math.ceil((members.size - 1) / 2))) lines.push(`Class signal: ${n} said "${type}"`);

  let summary = '<small class="mut">Engagement files not loaded.</small>';
  if (eng) {
    const people = {};
    for (const [uid, info] of members) {
      if (uid === me.id) continue;
      const s = states.get(uid); if (!s) continue;
      const bad = s.state === eng.STATE.PASSIVE_ABSENT || s.state === eng.STATE.SPOOF_SUSPECT;
      people[uid] = { state: s.state, absentForMs: bad ? now - s.since : 0, joinedAtMs: info.joinedAt };
    }
    const start = meeting.started_at ? Date.parse(meeting.started_at) : joinedAt;
    const v = eng.hostView(people, { now, meetingStartMs: start, meetingDurationMin: meeting.duration_min, demoMode: $('demo').checked });
    if (v.focusAlert) lines.push('Focus alert: more than half of the class looks disengaged or away.');
    if (v.flaggedStreams.length) lines.push('Possible frozen or looped camera: ' + v.flaggedStreams.map(nameOf).join(', '));
    const list = (label, ids) => (ids.length ? `${label}: ${ids.map((i) => esc(nameOf(i))).join(', ')}<br>` : '');
    summary = list('Stepped away (no alert yet)', v.steppedAway) + list('Be right back', v.excused) +
      list('Working on something else (not alerted)', v.suppressedSecondary) || '<small class="mut">Everyone looks engaged.</small>';
  }
  $('alertbar').hidden = !lines.length; $('alertbar').innerHTML = lines.map(esc).join('<br>');
  $('summary').innerHTML = summary;
  $('people').innerHTML = [...members].filter(([u]) => u !== me.id).map(([u, i]) => {
    const s = states.get(u);
    return `<div class="person"><div>${esc(i.username)}<small>${s ? esc(FRIENDLY[s.state] || s.state) : 'Engagement estimation off'}</small></div>
      <div><button class="ghost" data-act="mute" data-uid="${u}">Mute</button><button class="ghost" data-act="remove" data-uid="${u}">Remove</button></div></div>`;
  }).join('') || '<small class="mut">Nobody else has joined yet.</small>';
}
$('people').addEventListener('click', (e) => { const { act, uid } = e.target.dataset; if (act) sendMod(act, uid); });
$('demo').onchange = renderHost;
setInterval(renderHost, 2000);

window.addEventListener('beforeunload', () => { try { peer?.destroy(); channel?.unsubscribe(); } catch {} });
boot();
