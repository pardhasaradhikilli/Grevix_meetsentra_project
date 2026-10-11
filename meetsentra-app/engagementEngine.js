// MeetSentra engagement engine (runs on each participant's own device).
// Input: simple signals once per second. Output: one of four states.
// No video or screen content ever leaves this module, only the state.

export const STATE = {
  ENGAGED: 'engaged',
  ACTIVE_SECONDARY: 'active_secondary', // working on something else but still responding
  PASSIVE_ABSENT: 'passive_absent',     // present on the call but not really there
  SPOOF_SUSPECT: 'spoof_suspect',       // static or looped camera feed
  EXCUSED: 'excused',                   // tapped "be right back" (washroom, fetch something)
};

export const DEFAULTS = {
  corroborationWindowMs: 60_000, // chat / reaction / audio counts for this long
  noFaceHoldMs: 10_000,          // no face + no responses for this long -> absent
  awayHoldMs: 30_000,            // looking away / window unfocused + no responses
  spoofHoldMs: 2_000,            // spoof flag must persist this long (anti-flicker)
};

// Host alert timing scales with the length of the meeting.
//  60 min class -> no alerts for the first 10 min; a person must be gone ~5 min before the host hears.
//  30 min -> 5 min grace, 2.5 min tolerance.   120 min -> 10 min grace, 10 min tolerance.
// demoMode: short timers so the Challenge Card demo (flag within ~15 s) still works on stage.
export function timingsForMeeting(durationMin = 60, { demoMode = false } = {}) {
  if (demoMode) return { startGraceMs: 0, absenceToleranceMs: 10_000 };
  const d = Math.max(1, durationMin);
  return {
    startGraceMs: Math.min(10, d / 6) * 60_000,
    absenceToleranceMs: Math.min(10, Math.max(2, d / 12)) * 60_000,
  };
}

export class EngagementEngine {
  constructor(config = {}) {
    this.cfg = { ...DEFAULTS, ...config };
    this.state = STATE.ENGAGED;
    this.pending = null;
    this.pendingSince = null;
    this.spoofSince = null;
    this.badSince = null;      // when the current absent/spoof episode began
    this.excusedUntil = 0;     // "be right back" timer
    this.last = { chat: -Infinity, reaction: -Infinity, audio: -Infinity };
  }

  noteChat(t = Date.now()) { this.last.chat = t; }
  noteReaction(t = Date.now()) { this.last.reaction = t; }
  noteAudio(t = Date.now()) { this.last.audio = t; }
  // "Be right back" button: the person is excused from absence alerts for a while.
  excuse(now = Date.now(), ms = 10 * 60_000) { this.excusedUntil = now + ms; }
  cancelExcuse() { this.excusedUntil = 0; }

  // s = { facePresent, gazeOnScreen (true|false|null), windowFocused, spoofStatic, spoofLoop,
  //       livenessRecent (optional: true if the face model saw a blink / landmark jitter in the last ~8 s) }
  update(now, s) {
    const c = this.cfg;
    const cutoff = now - c.corroborationWindowMs;
    const corroboratingTypes =
      (this.last.chat >= cutoff ? 1 : 0) +
      (this.last.reaction >= cutoff ? 1 : 0) +
      (this.last.audio >= cutoff ? 1 : 0);
    const corroborated = corroboratingTypes > 0;

    // Spoof flag must hold for a moment before it counts.
    // A frozen picture has no blinks or landmark jitter; a very still real person does.
    const staticSpoof = s.spoofStatic && s.livenessRecent !== true;
    if (staticSpoof || s.spoofLoop) { this.spoofSince ??= now; } else { this.spoofSince = null; }
    const spoofConfirmed = this.spoofSince !== null && now - this.spoofSince >= c.spoofHoldMs;

    let target, hold = 0, promptable = false;
    const reasons = [];

    if (spoofConfirmed) {
      target = STATE.SPOOF_SUSPECT;
      reasons.push(s.spoofLoop ? 'camera feed repeats in a loop' : 'camera feed is frozen/static');
    } else if (!s.facePresent) {
      if (corroborated) {
        target = STATE.ACTIVE_SECONDARY;
        reasons.push('no face in view, but recent chat/reaction/audio');
      } else {
        target = STATE.PASSIVE_ABSENT; hold = c.noFaceHoldMs;
        reasons.push('no face in view and no responses');
      }
    } else if (s.windowFocused && s.gazeOnScreen !== false) {
      target = STATE.ENGAGED;
      reasons.push('face present, meeting in focus');
    } else if (corroborated) {
      target = STATE.ACTIVE_SECONDARY;
      reasons.push('meeting window not in focus, but still responding');
    } else {
      target = STATE.PASSIVE_ABSENT; hold = c.awayHoldMs; promptable = true;
      reasons.push('looking away or window unfocused with no responses');
    }

    // A \"be right back\" tap excuses plain absence (never a spoofed feed).
    if (now < this.excusedUntil && target === STATE.PASSIVE_ABSENT) {
      target = STATE.EXCUSED; hold = 0; promptable = false;
      reasons.length = 0; reasons.push('stepped away (be-right-back)');
    }

    // Good states and spoof flags switch immediately; "absent" needs to persist (hysteresis).
    let promptPulse = false;
    if (hold === 0) {
      this.pending = null; this.pendingSince = null;
      this.state = target;
    } else {
      if (this.pending !== target) { this.pending = target; this.pendingSince = now; }
      const elapsed = now - this.pendingSince;
      if (elapsed >= hold) this.state = target;
      // Halfway to "absent" for a present-but-away person: ask for a one-tap "I'm here".
      if (promptable && elapsed >= hold / 2) promptPulse = true;
    }

    if (this.state === STATE.PASSIVE_ABSENT) this.badSince ??= this.pendingSince ?? now;
    else if (this.state === STATE.SPOOF_SUSPECT) this.badSince ??= this.spoofSince ?? now;
    else this.badSince = null;
    const absentForMs = this.badSince === null ? 0 : now - this.badSince;

    return { state: this.state, reasons, corroboratingTypes, promptPulse, absentForMs };
  }
}

// Host-side view. participants = { id: { state, absentForMs, joinedAtMs? } }
// - No alerts during the start-up grace period (people are still setting up).
// - A person who has stepped away is only counted after the tolerance (about 5 min in a 60 min class).
// - Grace is per person, so late joiners also get time to settle in.
export function hostView(participants, {
  now = Date.now(), meetingStartMs = now, meetingDurationMin = 60, threshold = 0.5, demoMode = false,
} = {}) {
  const { startGraceMs, absenceToleranceMs } = timingsForMeeting(meetingDurationMin, { demoMode });
  const ids = Object.keys(participants);
  const alertable = [], flaggedStreams = [], steppedAway = [], excused = [], suppressedSecondary = [];

  for (const id of ids) {
    const p = participants[id];
    const graceEnd = Math.max(meetingStartMs, p.joinedAtMs ?? meetingStartMs) + startGraceMs;
    const inGrace = now < graceEnd;
    if (p.state === STATE.ACTIVE_SECONDARY) suppressedSecondary.push(id);   // never alerted on, by design
    else if (p.state === STATE.EXCUSED) excused.push(id);
    else if (p.state === STATE.SPOOF_SUSPECT) {
      if (!inGrace) { flaggedStreams.push(id); alertable.push(id); }
    } else if (p.state === STATE.PASSIVE_ABSENT && !inGrace) {
      // count the absence from the later of "left" and "grace ended"
      const goneSince = Math.max(now - (p.absentForMs ?? 0), graceEnd);
      if (now - goneSince >= absenceToleranceMs) alertable.push(id);
      else steppedAway.push(id);                                             // shown quietly, no alert
    }
  }
  return {
    focusAlert: ids.length > 0 && alertable.length / ids.length > threshold, // room-level alert
    flaggedStreams,                                                           // spoofed streams, per person
    alertable,
    steppedAway,                                                              // away, still within tolerance
    excused,
    suppressedSecondary,
  };
}
