import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createEngagementRuntime } from './engine/clientSignals.js';
import { STATE, hostView } from './engine/engagementEngine.js';
import { checkMessage } from './moderation.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const meetingId = new URLSearchParams(location.search).get('m');

let me, meeting, isHost, localStream, peer, channel, runtime, muted = false, lastState = null, brbOn = false, lastPulse = 0;
const hostJoinedAt = Date.now();
const members = new Map(), states = new Map(), calls = new Map(), strikes = new Map();
let pulses = [];

const note = (t) => { $('notice').textContent = t; };
const nameOf = (uid) => members.get(uid)?.username || uid.slice(0, 6);

// ---------- start ----------
async function boot() {
  $('denied').textContent = '';
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { location.href = 'index.html'; return; }
  const { data: prof } = await sb.from('profiles').select('id,username').eq('id', user.id).single();
  me = prof;
  const { data: m } = await sb.from('meetings').select('id,title,duration_min,room_code,started_at,host_id').eq('id', meetingId).maybeSingle();
  if (!m) { $('denied').textContent = 'You are not invited to this meeting, or it does not exist.'; return; }
  meeting = m; isHost = m.host_id === me.id;
  $('title').textContent = m.title;
  $('gate').hidden = false;
  $('joinFocus').onclick = () => join(true);
  $('joinPlain').onclick = () => join(false);
}

async function join(withFocus) {
  $('gate').hidden = true; $('room').hidden = false;
  try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
  catch { try { localStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    catch { localStream = new MediaStream(); note('No camera or mic access. You can still chat.'); } }
  addTile(me.id, `${me.username} (you)`, localStream, true);
  if (!isHost) sb.from('invites').update({ joined_at: new Date().toISOString() }).eq('meeting_id', meeting.id).eq('user_id', me.id).then(() => {});

  peer = new Peer('ms-' + me.id);
  peer.on('call', async (call) => {
    if (!(await waitKnown(call.peer))) return call.close(); // only answer people who are in this room
    call.answer(localStream); wireCall(call);
  });
  peer.on('open', () => openChannel(withFocus));
  peer.on('error', (e) => note('Video connection issue: ' + e.type));
}

const waitKnown = async (peerId) => {
  for (let i = 0; i < 20; i++) {
    if ([...members.values()].some((m) => m.peerId === peerId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

// ---------- video tiles ----------
function addTile(uid, label, stream, self) {
  let t = $('tile-' + uid);
  if (!t) {
    t = document.createElement('div'); t.className = 'tile'; t.id = 'tile-' + uid;
    t.innerHTML = '<video autoplay playsinline></video><span></span>';
    $('videos').appendChild(t);
  }
  const v = t.querySelector('video'); v.srcObject = stream; v.muted = !!self;
  t.querySelector('span').textContent = label;
}
const removeTile = (uid) => $('tile-' + uid)?.remove();
function wireCall(call) {
  const uid = call.peer.slice(3);
  calls.set(uid, call);
  call.on('stream', (s) => addTile(uid, nameOf(uid), s, false));
  call.on('close', () => removeTile(uid));
}

// ---------- room channel ----------
function openChannel(withFocus) {
  channel = sb.channel('room:' + meeting.room_code, { config: { presence: { key: me.id }, broadcast: { self: true } } });
  channel
    .on('presence', { event: 'sync' }, syncMembers)
    .on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'pulse' }, ({ payload }) => { pulses.push({ t: Date.now(), type: payload.type }); })
    .on('broadcast', { event: 'flag' }, ({ payload }) => onFlag(payload))
    .on('broadcast', { event: 'mod' }, ({ payload }) => onMod(payload))
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track({ username: me.username, peerId: 'ms-' + me.id, joinedAt: Date.now(), host: isHost });
      if (withFocus && localStream.getVideoTracks().length) startFocus(); else note(withFocus ? 'No camera, so focus estimation is off.' : 'Focus estimation is off for you.');
    });
}

function syncMembers() {
  const st = channel.presenceState(), next = new Map();
  for (const [uid, arr] of Object.entries(st)) next.set(uid, arr[0]);
  for (const uid of [...members.keys()]) if (!next.has(uid)) { calls.get(uid)?.close(); calls.delete(uid); removeTile(uid); states.delete(uid); }
  members.clear(); next.forEach((v, k) => members.set(k, v));
  if (localStream?.getTracks().length) {
    for (const [uid, info] of members) {
      if (uid !== me.id && !calls.has(uid) && me.id < uid) wireCall(peer.call(info.peerId, localStream)); // lower id calls, avoids double calls
    }
  }
  renderHost();
}

// ---------- chat + moderation ----------
function onChat(p) {
  const d = document.createElement('p');
  d.innerHTML = `<b>${esc(p.username)}:</b> ${esc(p.text)}`;
  $('log').appendChild(d); $('log').scrollTop = $('log').scrollHeight;
}
$('send').onclick = () => {
  const text = $('msg').value.trim(); if (!text) return;
  if (muted) return note('The host has muted you.');
  const r = checkMessage(text);
  if (r.blocked) {
    note('Message blocked: please keep the chat respectful.');
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
  note(`${p.username}'s message was blocked (${n}).`);
  if (n >= 3) { strikes.set(p.uid, 0); sendMod('mute', p.uid); }
}
function sendMod(action, target) { channel.send({ type: 'broadcast', event: 'mod', payload: { action, target, from: me.id } }); }
function onMod(p) {
  // NOTE: prototype only. A determined invited user could forge this; real enforcement needs a server.
  if (p.target !== me.id || p.from !== meeting.host_id) return;
  if (p.action === 'mute') {
    muted = true; localStream.getAudioTracks().forEach((t) => (t.enabled = false));
    note('The host muted you.');
  } else if (p.action === 'remove') { alert('You were removed from this meeting by the host.'); location.href = 'index.html'; }
}

// ---------- engagement ----------
async function loadDetector() {
  const { FaceDetector, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
    runningMode: 'VIDEO',
  });
}

async function startFocus() {
  const video = $('tile-' + me.id).querySelector('video');
  let det;
  try { det = await loadDetector(); } catch (e) { return note('Focus estimation could not start: ' + e.message); }
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
  runtime = createEngagementRuntime({
    videoEl: video,
    micStream: localStream.getAudioTracks().length ? localStream : null,
    getFaceState: () => ({ facePresent: faceNow, gazeOnScreen: null, livenessRecent: Date.now() - lastLiveAt < 8000 }),
    onStateChange: (s) => sendState(s),
    onPulsePrompt: () => { $('prompt').hidden = false; },
    workerUrl: new URL('./engine/spoofWorker.js', location.href),
  });
  $('brb').hidden = false;
  setInterval(() => lastState && sendState(lastState), 10000); // heartbeat
  note('Focus estimation is on (on this device only).');
}
function sendState(s) {
  lastState = s;
  channel.send({ type: 'broadcast', event: 'state', payload: { uid: me.id, state: s.state, reasons: s.reasons } });
}
function onState(p) {
  const prev = states.get(p.uid);
  states.set(p.uid, { state: p.state, reasons: p.reasons, since: prev && prev.state === p.state ? prev.since : Date.now() });
  renderHost();
}

// ---------- buttons ----------
$('here').onclick = () => { runtime?.noteReaction(); $('prompt').hidden = true; };
$('brb').onclick = () => {
  brbOn = !brbOn;
  brbOn ? runtime?.excuse() : runtime?.cancelExcuse();
  $('brb').textContent = brbOn ? "I'm back" : 'Be right back';
};
document.querySelectorAll('.pulse').forEach((b) => (b.onclick = () => {
  if (Date.now() - lastPulse < 120000) return note('You already sent a signal in the last 2 minutes.');
  lastPulse = Date.now(); runtime?.noteReaction();
  channel.send({ type: 'broadcast', event: 'pulse', payload: { type: b.dataset.type } });
  note(`Sent: "${b.dataset.type}" (anonymous)`);
}));
$('mic').onclick = () => { if (muted) return note('The host muted you.'); localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled)); };
$('cam').onclick = () => localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));

// ---------- host panel ----------
function renderHost() {
  if (!isHost || !channel) return;
  $('hostPanel').hidden = false;
  const now = Date.now(), people = {};
  for (const [uid, info] of members) {
    if (uid === me.id) continue;
    const s = states.get(uid); if (!s) continue;
    const bad = s.state === STATE.PASSIVE_ABSENT || s.state === STATE.SPOOF_SUSPECT;
    people[uid] = { state: s.state, absentForMs: bad ? now - s.since : 0, joinedAtMs: info.joinedAt };
  }
  const start = meeting.started_at ? Date.parse(meeting.started_at) : hostJoinedAt;
  const v = hostView(people, { now, meetingStartMs: start, meetingDurationMin: meeting.duration_min, demoMode: $('demo').checked });

  const lines = [];
  if (v.focusAlert) lines.push('Focus alert: more than half of the class looks disengaged or away.');
  if (v.flaggedStreams.length) lines.push('Possible frozen or looped camera: ' + v.flaggedStreams.map(nameOf).join(', '));
  const recent = pulses.filter((p) => now - p.t < 120000), counts = {};
  recent.forEach((p) => (counts[p.type] = (counts[p.type] || 0) + 1));
  for (const [type, n] of Object.entries(counts)) if (n >= Math.max(2, Math.ceil((members.size - 1) / 2))) lines.push(`Class signal: ${n} said "${type}"`);
  $('hostAlert').hidden = !lines.length; $('hostAlert').innerHTML = lines.map(esc).join('<br>');

  const list = (label, ids) => (ids.length ? `${label}: ${ids.map((i) => esc(nameOf(i))).join(', ')}<br>` : '');
  $('summary').innerHTML =
    list('Stepped away (no alert yet)', v.steppedAway) + list('Be right back', v.excused) +
    list('Working on something else (not alerted)', v.suppressedSecondary) +
    `<small class="k">Pulses in last 2 min: ${recent.length}</small>`;
  $('people').innerHTML = [...members].filter(([u]) => u !== me.id).map(([u, i]) => {
    const s = states.get(u);
    return `<div class="row"><span>${esc(i.username)} <small class="k">${s ? esc(s.state) : 'focus off'}</small></span>
      <span><button class="ghost" data-act="mute" data-uid="${u}">Mute</button><button class="ghost" data-act="remove" data-uid="${u}">Remove</button></span></div>`;
  }).join('');
}
$('people').addEventListener('click', (e) => { const { act, uid } = e.target.dataset; if (act) sendMod(act, uid); });
$('demo').onchange = renderHost;
setInterval(renderHost, 2000);

window.addEventListener('beforeunload', () => { try { peer?.destroy(); channel?.unsubscribe(); } catch {} });
boot();
