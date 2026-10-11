// Simulated demo scenarios for the Challenge Card 1 acceptance goal.
// Run: node test.mjs
import { EngagementEngine, STATE, hostView, timingsForMeeting } from './engagementEngine.js';
import { SpoofDetector } from './spoofDetector.js';

// ---- deterministic fake camera ----
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const S = 32;

function makeLiveCamera() {
  let x = 16, y = 16, vx = 0, vy = 0;
  return () => {
    vx = 0.9 * vx + gauss() * 0.9; vy = 0.9 * vy + gauss() * 0.9;
    x += vx; y += vy;
    if (x < 7 || x > 25) { vx = -vx; x = Math.min(25, Math.max(7, x)); }
    if (y < 7 || y > 25) { vy = -vy; y = Math.min(25, Math.max(7, y)); }
    const f = new Uint8Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const r2 = (i - x) ** 2 + (j - y) ** 2;
      const v = 80 + 0.5 * i + 0.3 * j + 120 * Math.exp(-r2 / 32) + gauss() * 1.5;
      f[j * S + i] = Math.max(0, Math.min(255, v));
    }
    return f;
  };
}
const withNoise = (f, sigma) => f.map((v) => Math.max(0, Math.min(255, Math.round(v + gauss() * sigma))));

// ---- run one participant for `secs` seconds ----
function simulate({ secs, face = () => true, focused = () => true, camera, chatAt = [], reactionAt = [], pulseOnPrompt = false }) {
  const engine = new EngagementEngine();
  const det = new SpoofDetector();
  const timeline = [];
  let prompted = false;
  for (let t = 0; t < secs; t++) {
    for (let k = 0; k < 3; k++) det.push(camera(t));
    if (chatAt.includes(t)) engine.noteChat(t * 1000);
    if (reactionAt.includes(t)) engine.noteReaction(t * 1000);
    const sp = det.analyze();
    const r = engine.update(t * 1000, {
      facePresent: face(t), gazeOnScreen: true, windowFocused: focused(t),
      spoofStatic: sp.static, spoofLoop: sp.loop,
    });
    if (r.promptPulse) { prompted = true; if (pulseOnPrompt) engine.noteReaction(t * 1000); }
    timeline.push({ t, state: r.state });
  }
  return { timeline, prompted };
}
const firstAt = (tl, state, from = 0) => tl.find((e) => e.t >= from && e.state === state)?.t;
const never = (tl, state) => !tl.some((e) => e.state === state);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`); if (!ok) failed++; };

// A) Split screen with an external editor: must NOT raise a false alert.
{
  const live = makeLiveCamera();
  const { timeline, prompted } = simulate({
    secs: 150, camera: live,
    focused: (t) => t < 10,           // meeting loses focus at t=10 (editor opens)
    chatAt: [12],                      // one chat reply
    pulseOnPrompt: true,               // taps "I'm here" when asked
  });
  check('A  split-screen: never flagged absent/spoof', never(timeline, STATE.PASSIVE_ABSENT) && never(timeline, STATE.SPOOF_SUSPECT));
  // t=10..11: window unfocused but no response yet -> still shown as engaged (grace period, no alert)
  // t=12: chat reply arrives -> classified as an active secondary task
  check('A  split-screen: classified as active secondary task once it responds', firstAt(timeline, STATE.ACTIVE_SECONDARY) === 12 && timeline[11].state === STATE.ENGAGED, `(at t=${firstAt(timeline, STATE.ACTIVE_SECONDARY)}s)`);
  check('A  gentle "I\'m here" prompt appeared before any alert', prompted);
}

// A2) Same participant but truly ignoring everything (no replies, no pulse): flagged eventually.
{
  const live = makeLiveCamera();
  const { timeline } = simulate({ secs: 150, camera: live, focused: (t) => t < 10, chatAt: [12] });
  const t = firstAt(timeline, STATE.PASSIVE_ABSENT);
  check('A2 unfocused with zero responses eventually flagged', t !== undefined, `(at t=${t}s, i.e. ${t - 12}s after last chat)`);
}

// B) Abandoned stream: face gone from t=20, no signals -> flagged within 15 s.
{
  const live = makeLiveCamera();
  const { timeline } = simulate({ secs: 60, camera: live, face: (t) => t < 20 });
  const t = firstAt(timeline, STATE.PASSIVE_ABSENT);
  check('B  abandoned: flagged within 15 s', t !== undefined && t - 20 <= 15, `(${t - 20}s after leaving)`);
}

// C) Frozen image as camera from t=20 -> flagged within 15 s.
{
  const live = makeLiveCamera(); const frozen = live();
  const cam = (t) => (t < 20 ? live() : withNoise(frozen, 0.05));
  const { timeline } = simulate({ secs: 60, camera: cam });
  const t = firstAt(timeline, STATE.SPOOF_SUSPECT);
  check('C  static spoof: flagged within 15 s', t !== undefined && t - 20 <= 15, `(${t - 20}s after switch)`);
  check('C  no false spoof flag before the switch', !timeline.some((e) => e.t < 20 && e.state === STATE.SPOOF_SUSPECT));
}

// D) 5-second looped video as camera from t=20 -> flagged within 15 s.
for (const loopSec of [4, 5, 8]) {
  const live = makeLiveCamera();
  const loopFrames = Array.from({ length: loopSec * 3 }, () => live());
  let idx = 0;
  const cam = (t) => (t < 20 ? live() : withNoise(loopFrames[idx++ % loopFrames.length], 0.15));
  const { timeline } = simulate({ secs: 60, camera: cam });
  const t = firstAt(timeline, STATE.SPOOF_SUSPECT);
  check(`D  ${loopSec}s loop spoof: flagged within 15 s`, t !== undefined && t - 20 <= 15, `(${t - 20}s after switch)`);
  check(`D  ${loopSec}s loop: no false flag on live feed first`, !timeline.some((e) => e.t < 20 && e.state === STATE.SPOOF_SUSPECT));
}

// E) False-positive check: 5 minutes of a normal live, engaged camera.
{
  const live = makeLiveCamera();
  const { timeline } = simulate({ secs: 300, camera: live });
  check('E  5 min normal live feed: always engaged', timeline.every((e) => e.state === STATE.ENGAGED));
}

// F) Host view basics (inside a normal meeting, after the grace period)
{
  const MIN = 60_000, start = 0, now = 30 * MIN;
  const v = hostView({
    a: { state: STATE.ENGAGED }, b: { state: STATE.ACTIVE_SECONDARY },
    c: { state: STATE.SPOOF_SUSPECT, absentForMs: 20_000 }, d: { state: STATE.ENGAGED },
  }, { now, meetingStartMs: start, meetingDurationMin: 60 });
  check('F  host: no room alert, spoof flagged, secondary suppressed',
    !v.focusAlert && v.flaggedStreams[0] === 'c' && v.suppressedSecondary[0] === 'b');
}

// G) Timing scales with the meeting length
{
  const t60 = timingsForMeeting(60), t30 = timingsForMeeting(30), t120 = timingsForMeeting(120);
  check('G  60 min class: 10 min grace, 5 min tolerance', t60.startGraceMs === 10 * 60000 && t60.absenceToleranceMs === 5 * 60000);
  check('G  30 min class: 5 min grace, 2.5 min tolerance', t30.startGraceMs === 5 * 60000 && t30.absenceToleranceMs === 150000);
  check('G  120 min class: capped at 10 min / 10 min', t120.startGraceMs === 10 * 60000 && t120.absenceToleranceMs === 10 * 60000);
}

// H) 60-minute class: no alerts in the first 10 min; short absences never alert; long ones do.
{
  const MIN = 60_000, opts = (nowMin) => ({ now: nowMin * MIN, meetingStartMs: 0, meetingDurationMin: 60 });
  const class8 = {};
  for (let i = 0; i < 10; i++) class8['p' + i] = { state: i < 6 ? STATE.PASSIVE_ABSENT : STATE.ENGAGED, absentForMs: 3 * MIN };
  check('H  minute 8: 60% of class absent, still inside grace -> no alert', !hostView(class8, opts(8)).focusAlert);

  const washroom = { a: { state: STATE.ENGAGED }, b: { state: STATE.PASSIVE_ABSENT, absentForMs: 2 * MIN }, c: { state: STATE.ENGAGED } };
  const w = hostView(washroom, opts(25));
  check('H  washroom break (2 min): no alert, listed as stepped away', !w.focusAlert && w.steppedAway[0] === 'b' && w.alertable.length === 0);

  const gone = {}; for (let i = 0; i < 4; i++) gone['p' + i] = { state: i < 3 ? STATE.PASSIVE_ABSENT : STATE.ENGAGED, absentForMs: 6 * MIN };
  check('H  3 of 4 gone for 6 min (past 5 min tolerance): alert', hostView(gone, opts(30)).focusAlert);

  // someone who vanished at minute 8 is counted from minute 10 (grace end), not minute 8
  const early = { a: { state: STATE.PASSIVE_ABSENT, absentForMs: 6 * MIN }, b: { state: STATE.ENGAGED } };
  check('H  gone since minute 8: not alertable at minute 12 (only 2 min after grace)', hostView(early, opts(12)).alertable.length === 0);
  check('H  gone since minute 8: alertable at minute 15', hostView(early, opts(15)).alertable.length === 1);
}

// I) Late joiner gets their own grace period; be-right-back excuses absence.
{
  const MIN = 60_000;
  const v = hostView({ a: { state: STATE.PASSIVE_ABSENT, absentForMs: 20 * MIN, joinedAtMs: 28 * MIN } },
    { now: 30 * MIN, meetingStartMs: 0, meetingDurationMin: 60 });
  check('I  late joiner (joined min 28) still in own grace at min 30', v.alertable.length === 0 && v.steppedAway.length === 0);

  const live = makeLiveCamera();
  const engine = new EngagementEngine(); const det = new SpoofDetector();
  engine.excuse(0, 10 * MIN);
  let last;
  for (let t = 0; t < 120; t++) {
    for (let k = 0; k < 3; k++) det.push(live());
    const sp = det.analyze();
    last = engine.update(t * 1000, { facePresent: false, gazeOnScreen: null, windowFocused: true, spoofStatic: sp.static, spoofLoop: sp.loop });
  }
  check('I  be-right-back: stays excused while away (not absent)', last.state === STATE.EXCUSED);
}

// J) Demo mode keeps the Card 1 "flag within ~15 s" demo working on stage.
{
  const v = hostView({ a: { state: STATE.PASSIVE_ABSENT, absentForMs: 11_000 }, b: { state: STATE.ENGAGED } },
    { now: 40_000, meetingStartMs: 0, meetingDurationMin: 5, demoMode: true });
  check('J  demo mode: absent for 11 s reaches the host', v.alertable.length === 1);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
