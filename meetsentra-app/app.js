import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { parseNames, isValidUsername, runBatches } from './bulk.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emailFor = (u) => `${u}@meetsentra.app`; // usernames are mapped to a private fake email
let me = null, channel = null;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 5000);
}
const cleanName = (v) => v.trim().toLowerCase();

async function signUp() {
  const username = cleanName($('u').value), password = $('p').value;
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3-20 letters, numbers or _');
  const { data, error } = await sb.auth.signUp({ email: emailFor(username), password });
  if (error) throw error;
  if (!data.session) throw new Error('In Supabase, turn OFF "Confirm email" (Authentication settings).');
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, username });
  if (e2) throw new Error(e2.code === '23505' ? 'That username is taken' : e2.message);
}

async function logIn() {
  const { error } = await sb.auth.signInWithPassword({ email: emailFor(cleanName($('u').value)), password: $('p').value });
  if (error) throw error;
}

async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('id,username').eq('id', user.id).single();
  return data;
}

async function loadInvites() {
  const { data, error } = await sb.from('invites')
    .select('meeting_id, meetings(id,title,duration_min,started_at,profiles!meetings_host_id_fkey(username))')
    .eq('user_id', me.id);
  if (error) return ($('invites').textContent = error.message);
  $('invites').innerHTML = data.length ? data.map((r) => `
    <div class="row card"><div><b>${esc(r.meetings.title)}</b><div class="mut">Host: ${esc(r.meetings.profiles.username)} · ${r.meetings.duration_min} min${r.meetings.started_at ? ' · LIVE' : ''}</div></div>
    <a class="btn" href="meeting.html?m=${r.meetings.id}">Join</a></div>`).join('') : 'None yet';
}

async function loadMine() {
  const { data, error } = await sb.from('meetings').select('id,title,duration_min,started_at').eq('host_id', me.id).order('created_at', { ascending: false });
  if (error) return ($('mine').textContent = error.message);
  $('mine').innerHTML = data.length ? data.map((m) => `
    <div class="row card"><div><b>${esc(m.title)}</b><div class="mut">${m.duration_min} min${m.started_at ? ' · started' : ''}</div></div>
    <div><button data-start="${m.id}" class="ghost">${m.started_at ? 'Restart clock' : 'Start'}</button>
    <a class="btn" href="meeting.html?m=${m.id}">Open</a></div></div>`).join('') : 'None yet';
}

let retryState = null; // invitations that failed and can be retried

// Look usernames up and invite them, 100 at a time. Each batch is retried; one bad batch does not stop the rest.
async function inviteNames(meetingId, names) {
  const look = await runBatches(names, async (part) => {
    const { data, error } = await sb.from('profiles').select('id,username').in('username', part);
    if (error) throw error;
    return data;
  });
  const found = look.results;
  const inv = await runBatches(found, async (part) => {
    // upsert + ignoreDuplicates makes re-sending safe: people who were already invited are skipped
    const { error } = await sb.from('invites').upsert(part.map((f) => ({ meeting_id: meetingId, user_id: f.id })),
      { onConflict: 'meeting_id,user_id', ignoreDuplicates: true });
    if (error) throw error;
  });
  return {
    invited: found.length - inv.failedItems.length,
    missing: names.filter((n) => !look.failedItems.includes(n) && !found.some((f) => f.username === n)),
    failed: [...look.failedItems, ...inv.failedItems.map((f) => f.username)],
  };
}

function reportInvites(r, invalid) {
  retryState = r.failed.length ? { ...retryState, names: r.failed } : null;
  $('retryBtn').hidden = !retryState; if (retryState) $('retryBtn').textContent = `Retry ${r.failed.length} failed invite${r.failed.length === 1 ? '' : 's'}`;
  $('createMsg').textContent = `Invited ${r.invited}.` +
    (r.missing.length ? ` Not registered yet: ${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? ` and ${r.missing.length - 8} more` : ''}.` : '') +
    (r.failed.length ? ` ${r.failed.length} could not be sent (network or server problem). Tap retry.` : '') +
    (invalid ? ` Skipped ${invalid} invalid username(s).` : '');
}

async function createMeeting() {
  const title = $('title').value.trim(), dur = parseInt($('dur').value, 10) || 60;
  const all = parseNames($('who').value).filter((n) => n !== me.username);
  const names = all.filter(isValidUsername), invalid = all.length - names.length;
  if (!title) throw new Error('Add a title');
  if (!names.length) throw new Error('Invite at least one username');
  $('createMsg').textContent = `Creating the meeting and inviting ${names.length} people...`;
  const { data: m, error: e2 } = await sb.from('meetings').insert({ host_id: me.id, title, duration_min: dur }).select('id').single();
  if (e2) throw e2;
  retryState = { meetingId: m.id };
  reportInvites(await inviteNames(m.id, names), invalid);
  $('title').value = ''; $('who').value = '';
  loadMine();
}

async function retryInvites() {
  if (!retryState?.names?.length) return;
  $('retryBtn').disabled = true; $('createMsg').textContent = 'Retrying...';
  try { reportInvites(await inviteNames(retryState.meetingId, retryState.names), 0); }
  catch (e) { $('createMsg').textContent = e.message; }
  $('retryBtn').disabled = false;
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('my-invites')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invites', filter: `user_id=eq.${me.id}` },
      () => { toast('You have a new meeting invitation'); loadInvites(); })
    .subscribe();
}

async function showApp() {
  me = await loadMe();
  $('auth').hidden = !!me; $('app').hidden = !me;
  if (!me) return;
  $('me').textContent = me.username;
  await Promise.all([loadInvites(), loadMine()]);
  subscribe();
}

const guard = (fn, errEl) => async () => { try { errEl.textContent = ''; await fn(); await showApp(); } catch (e) { errEl.textContent = e.message; } };
$('login').onclick = guard(logIn, $('authErr'));
$('signup').onclick = guard(signUp, $('authErr'));
$('create').onclick = async () => { try { await createMeeting(); } catch (e) { $('createMsg').textContent = e.message; } };
$('who').addEventListener('input', () => { const n = parseNames($('who').value).length; $('createMsg').textContent = n ? `${n} username${n === 1 ? '' : 's'} ready` : ''; });
$('whoFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $('who').value = ($('who').value + '\n' + (await f.text())).trim();
  $('createMsg').textContent = `${parseNames($('who').value).length} usernames loaded from ${f.name}`; e.target.value = '';
};
$('retryBtn').onclick = retryInvites;
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('mine').addEventListener('click', async (e) => {
  const id = e.target.dataset?.start; if (!id) return;
  await sb.from('meetings').update({ started_at: new Date().toISOString() }).eq('id', id); // meeting clock for grace timing
  loadMine();
});
showApp();
