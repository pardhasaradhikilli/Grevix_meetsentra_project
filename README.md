# MeetSentra: An AI-Powered Platform for Secure Video Conferencing, Intelligent Moderation, and Participant Engagement Awareness

**Tagline: "Smarter Meetings. Safer Connections."**

**An invite-only video meeting app that keeps strangers out, tells the host when the room is losing focus, and blocks abuse.**

Built solo during **Grevix AfterCode 2026** (24-hour online hackathon, Oct 11-12, 2026).

- **Live demo:** [add link here]
- **Demo video (optional):** [add link here]
- **Author:** [your name] ([your GitHub username])

> **Honesty note:** the feature table below shows what is working, in progress, or planned at the time of submission. Statuses are updated as the build moves forward.

---

## 1. The First Spark: what I'm building and why

### The problem
Online classes and meetings are usually joined through a **shared link**. Links get forwarded, posted in groups, and leaked, so unknown people join, disrupt sessions, and use abusive language. On top of that, a host presenting to many people has **no easy way to tell when the room has stopped paying attention**, especially with large groups or cameras off.

### Who it's for
- Teachers and trainers running online classes
- Small teams and clubs running internal meetings
- Anyone who needs a meeting where only the right people can enter

### The solution
MeetSentra combines three ideas in one app:

1. **Invite-only access.** There is no public meeting link. The host picks registered usernames, and each invitee gets an in-app notification to join.
2. **Focus awareness.** With consent, an engagement estimate is calculated on each participant's own device. If more than half of the room looks disengaged, the host gets a gentle alert.
3. **Abuse moderation.** Abusive chat messages are blocked, the sender is flagged, and the host can mute or remove them.

For people who keep their camera off, an anonymous **"Lost me" button** gives the host the same signal without needing video.

### Why it matters
A meeting is only useful if the right people are in it and paying attention. MeetSentra protects the room from outsiders, protects participants from abuse, and helps hosts notice a disengaged room while they can still do something about it.

---

## 2. Features and status

| # | Feature | What it does | Status |
|---|---------|--------------|--------|
| 1 | User registration and login | Users sign up with a unique username | [ ] Planned / [ ] In progress / [ ] Done |
| 2 | Invite-only meetings | Host creates a meeting and invites specific usernames | [ ] |
| 3 | In-app invite notifications | Invitees see a notification and join from the app, with no link | [ ] |
| 4 | Access control | Anyone not on the invite list cannot enter, even if they know the meeting ID | [ ] |
| 5 | Live video and audio | Meeting rooms powered by a video service | [ ] |
| 6 | Chat with abuse filter | Abusive messages are blocked, and the sender is flagged | [ ] |
| 7 | Host moderation controls | Host can mute or remove a participant | [ ] |
| 8 | Focus estimation (consent-based) | On-device engagement estimate from the camera | [ ] |
| 9 | Host focus alert | Alert when more than 50% of participants look disengaged | [ ] |
| 10 | "Lost me" pulse button | Anonymous signal for camera-off participants | [ ] |
| 11 | Meeting recap | Timeline showing when engagement dipped | [ ] |
| 12 | Voice abuse detection | Speech-based moderation (stretch goal) | [ ] |

*Tick the boxes and delete the unused status words before submission. Only list features that actually work as "Done".*

---

## 3. How it works

### 3.1 Invite-only access
1. A user registers and picks a **unique username**.
2. The host creates a meeting and selects invitees by username.
3. The server stores the allowed list for that meeting.
4. Each invitee receives an **in-app notification** with a join button.
5. When someone tries to join, the server checks they are logged in **and** on the list. If not, entry is refused.

There is no shareable URL that grants entry, so there is nothing to leak.

### 3.2 Focus estimation
1. When the meeting starts, each participant is asked for **explicit consent** to use their camera for focus estimation.
2. If they agree, a face/gaze landmark model runs **in their browser**.
3. It looks at simple signals: is a face present, which way is the head turned, and are the eyes roughly toward the screen.
4. Each participant's device produces a simple state, such as *engaged* or *disengaged*, and sends **only that state** to the server, never the video.
5. The server counts how many participants are disengaged. If more than **50%** are, the host receives an alert.

If a participant declines the camera, they are simply excluded from the focus calculation, and they can still use the "Lost me" button.

### 3.3 "Lost me" pulse button
Participants can tap **"Lost me"**, **"Too fast"**, or **"Need a break"** at any time. Taps are anonymous and counted. If more than 50% of participants tap within a short window, the host gets an alert. This works with cameras off and needs no video analysis.

### 3.4 Abuse moderation
1. Each chat message is checked against a **word list and pattern rules** (including common spelling tricks such as symbol substitutions).
2. If it matches, the message is **blocked** and not shown to others.
3. The sender is flagged, and the host sees who triggered it.
4. The host can **mute** or **remove** that participant.
5. Repeated violations can trigger an automatic mute.

Speech-based moderation (speech-to-text plus the same filter) is a stretch goal.

---

## 4. Architecture

```
Browser (participant)
 ├─ UI (React / Next.js)
 ├─ Video room (video service SDK)
 ├─ On-device focus model  ──►  sends only "engaged / disengaged" state
 └─ Chat + "Lost me" button
          │
          ▼
Backend (Supabase / Firebase)
 ├─ Auth (usernames)
 ├─ Meetings + invite lists
 ├─ Notifications (realtime)
 ├─ Chat messages + moderation flags
 └─ Aggregated focus / pulse counts  ──►  alert to host
```

---

## 5. Tech stack

*Update this list to match what you actually used.*

| Area | Choice |
|------|--------|
| Frontend | React / Next.js |
| Auth, database, realtime | Supabase or Firebase |
| Video and audio | Jitsi, LiveKit, or Daily |
| Focus model | MediaPipe (face / gaze landmarks), running in the browser |
| Chat filter | Rule-based word list and pattern matching |
| Hosting | Vercel / Netlify |

### AI tools used
*List honestly, for example:*
- [AI coding assistant name]: used for [what it helped with]
- [Any model or API]: used for [what]

---

## 6. Privacy, ethics, and security

- **Consent first.** The camera is used for focus estimation only after the participant explicitly agrees.
- **On-device processing.** Video frames are analyzed in the participant's browser. They are **not stored and not uploaded** for focus estimation.
- **Only a state leaves the device.** The server receives "engaged" or "disengaged", not images.
- **An estimate, not a verdict.** The focus score is a rough signal. It can be wrong (for example, someone looking at notes). It should help the host pace the session, not judge or punish anyone.
- **Anonymous pulse.** "Lost me" taps are counted without showing who tapped.
- **Invite-only by design.** Server-side checks on every join, so guessing a meeting ID is not enough.
- **Moderation transparency.** Participants can see that chat is filtered.

---

## 7. Getting started

### Prerequisites
- Node.js [version]
- An account with [Supabase / Firebase] and [video service]

### Setup
```bash
git clone [your-repo-url]
cd [your-repo-name]
npm install
cp .env.example .env.local
# fill in the values below
npm run dev
```

### Environment variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
[VIDEO_SERVICE_KEY_NAME]=
```
Never commit real keys. Keep them in `.env.local` and list the variable names only in `.env.example`.

---

## 8. Project structure

*Adjust to match your repo.*

```
/app or /src
  /components     UI pieces (meeting room, chat, invite list, alerts)
  /lib            auth, meeting access checks, moderation filter, focus helpers
  /pages or /app  routes: login, dashboard, meeting room
/public           static assets
.env.example      variable names only
README.md
```

---

## 9. Demo script (about 90 seconds)

1. Log in as the **host**, create a meeting, and invite two usernames.
2. Log in as an **invitee** in another browser, see the notification, and join.
3. Try to join as a **non-invited user** and show that entry is refused.
4. Send an **abusive chat message** and show it blocked and the sender flagged.
5. Show the host **muting or removing** the participant.
6. Trigger the **focus alert** (turn away from the camera, or have several participants tap "Lost me").
7. Show the **recap** with the engagement dip.

---

## 10. How the project evolved through the Challenge Cards

*Fill this in during the event. Write it honestly.*

### Before the cards (Phase 1: Ignition)
- What I planned to build: [...]
- What I had working by the end: [...]

### Challenge Card 1
- **The card said:** [...]
- **What I kept:** [...]
- **What I changed or removed:** [...]
- **What I rebuilt:** [...]
- **Why:** [...]

### Challenge Card 2
- **The card said:** [...]
- **What I kept:** [...]
- **What I changed or removed:** [...]
- **What I rebuilt:** [...]
- **Why:** [...]

---

## 11. Build log / decision log

*Add a line each time you make a notable decision.*

| Time | What AI helped with | What I decided | What I rejected, and why |
|------|---------------------|----------------|--------------------------|
| [hh:mm] | [...] | [...] | [...] |
| [hh:mm] | [...] | [...] | [...] |

---

## 12. Known limitations

- Focus estimation is approximate. Lighting, camera angle, glasses, and looking at notes can affect it.
- It works best with a visible face and a decent camera.
- Speech-based abuse detection is [implemented / not implemented].
- The word-list filter can miss new slang or context-based abuse.
- Free tiers of the video and backend services limit meeting size and duration.

## 13. Future work

- Speech-to-text moderation
- Per-meeting moderation rules set by the host
- Better engagement signals that don't depend on the camera
- Role-based access (co-hosts, moderators)
- Accessibility improvements and multi-language filters

---

## 14. Hackathon compliance

- Built **solo** during the official 24-hour AfterCode period (Oct 11-12, 2026).
- Repository created on [date and time], with commits throughout the build.
- Existing libraries, frameworks, APIs, and AI tools were used and are listed in Section 5.
- All implementation decisions and the final submission are my own responsibility.

## 15. License

[MIT or your choice]
