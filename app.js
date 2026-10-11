import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
    .select('meeting_id, meetings(id,title,duration_min,started_at,profiles(username))')
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

async function createMeeting() {
  const title = $('title').value.trim(), dur = parseInt($('dur').value, 10) || 60;
  const names = [...new Set($('who').value.split(',').map(cleanName).filter(Boolean))].filter((n) => n !== me.username);
  if (!title) throw new Error('Add a title');
  if (!names.length) throw new Error('Invite at least one username');
  const { data: found, error: e1 } = await sb.from('profiles').select('id,username').in('username', names);
  if (e1) throw e1;
  const missing = names.filter((n) => !found.some((f) => f.username === n));
  const { data: m, error: e2 } = await sb.from('meetings').insert({ host_id: me.id, title, duration_min: dur }).select('id').single();
  if (e2) throw e2;
  if (found.length) {
    const { error: e3 } = await sb.from('invites').insert(found.map((f) => ({ meeting_id: m.id, user_id: f.id })));
    if (e3) throw e3;
  }
  $('createMsg').textContent = `Invited ${found.length}` + (missing.length ? `. Not found: ${missing.join(', ')}` : '');
  $('title').value = ''; $('who').value = '';
  loadMine();
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
$('logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('mine').addEventListener('click', async (e) => {
  const id = e.target.dataset?.start; if (!id) return;
  await sb.from('meetings').update({ started_at: new Date().toISOString() }).eq('id', id); // meeting clock for grace timing
  loadMine();
});
showApp();
