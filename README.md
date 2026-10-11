# MeetSentra — Smarter Meetings. Safer Connections.

> **Grevix AfterCode 2026 | Solo hackathon project | October 11–12, 2026**
>
> **Live demo:** https://meetsentra.vercel.app/  
> **Repository:** https://github.com/pardhasaradhikilli/Grevix_meetsentra_project

MeetSentra is a prototype for more secure, inclusive, and participant-aware online meetings. The idea is to help hosts keep meetings controlled and useful while giving participants safer ways to communicate confusion or request a change of pace.

> **Project status and honesty:** This README documents the idea, prototype, development journey, known issues, and intended direction. A feature described as a goal or design is not necessarily implemented or verified. Update the status table and feedback section with evidence from the final build before submitting.

---

## 1. The problem I wanted to solve

Online classes and meetings often rely on shared links. Links can be forwarded beyond the intended group, and hosts may struggle to manage participation or keep a session productive. In a lecture, a participant may be confused but hesitate to interrupt. Camera-based engagement signals can also be unreliable and raise privacy concerns.

I wanted to explore one question:

**Can an online meeting experience help hosts protect the room and notice when participants need support, without treating people as surveillance targets?**

### Who could benefit?

- Teachers, lecturers, and trainers running online sessions
- Students who need a low-pressure way to say they are lost
- Small teams, clubs, and communities holding private meetings
- Hosts who need clearer moderation and participant controls

## 2. My proposed solution

MeetSentra brings together three central ideas:

1. **Controlled meeting access:** invite people by username and make unauthorized access harder.
2. **Participant-aware meetings:** offer an optional, consent-based engagement signal and a simple way for participants to ask for clarification.
3. **Chat moderation:** use rule-based checks to identify or block inappropriate messages, with host controls where supported.

The product direction also includes **Lecture Mode**: a host-focused view for teaching, with a way to change back to a normal meeting layout. The intended design should separate hiding participant tiles from turning off their cameras; hiding a tile should not imply that a camera stream has been disabled.

## 3. Features and implementation status

The status below separates features added to the prototype from features verified in live use. The latest implementation has passed simulated tests, but the new accessibility and classroom controls have **not yet been tested on real phones**. Please do not interpret simulated tests as proof of a production-ready system.

| Feature | Current status and behavior |
|---|---|
| Sign-up/login and meeting dashboard | Existing prototype flow; verify end-to-end on the deployed version |
| Meeting creation and username invitations | Implemented in the prototype; the previously observed Supabase relationship/embed error still needs a live regression test |
| Live audio/video | Not yet verified on real devices with multiple participants |
| Class Settings (host only) | Added: host can choose video visibility, who can chat, who can unmute, and whether anonymous questions are enabled |
| Video visibility / Lecture Mode | Added: (1) everyone sees everyone, (2) lecture mode where only the host sees participants, or (3) lecture mode where participants can choose to show their video |
| Lecture Mode connection design | In lecture mode, students connect only to the host, so student video is not sent to other students through student-to-student links |
| My Settings (all participants) | Added: text size, high contrast, reduced motion, and “show my video to the class” when the host's settings allow it |
| Request to speak | Added: students request a turn; the host can “Let speak” or “End turn”; students see their queue position. The person with the floor is connected to everyone |
| Microphone floor control | Added as a setting: host can set microphones to “only when given the floor”; real live-video handover still needs device testing |
| Anonymous question box | Added: questions are submitted without a name or ID, participants can upvote, rude questions are blocked, and the host can mark questions answered or hide them |
| Keyboard accessibility | Added shortcuts: M = microphone, V = camera, C = chat, Q = questions, S = settings, Esc = close panels |
| Screen-reader and motion support | Added screen-reader labels, high contrast, adjustable text size for panels/chat, and reduced-motion support including the device preference |
| Chat and microphone permissions | Some rules are enforced in each participant's browser and can be bypassed by a technically capable user; do not treat them as server-enforced security |
| Mute/remove enforcement | Not fully enforceable by the current peer-to-peer video design; stronger enforcement needs a media server such as LiveKit. A server-side removal approach using invite deletion and private rooms remains roadmap work |
| Persistence of questions and speaking queue | Current host-browser state is lost if the host refreshes; server-side persistence is future work |
| Engagement estimation / Meeting Pulse | Earlier project direction; only claim these are working if the current deployed build demonstrates them |
| Meeting summaries | Suggested in feedback; not claimed as implemented unless added and tested |
| Mobile readiness | Not verified on real phones yet; a three-phone test (one host, two students) is the next priority |

### Recent classroom/accessibility additions

- **Class Settings** is host-only. It covers video visibility, chat permissions, microphone permissions, and anonymous questions.
- **My Settings** is available to everyone and covers text size, high contrast, reduced motion, and video visibility where permitted.
- **Lecture Mode** changes the connection pattern: students connect to the host rather than to one another. In the developer's simulated tests, a class of 10 had no student-to-student links; a class of 30 produced 12 video slots, with remaining participants in audience mode. These are simulation results, not real-phone performance measurements.
- **Request to speak** provides a queue and host-controlled floor handover.
- **Anonymous questions** can be upvoted and moderated by the host.
- **Accessibility basics** include keyboard shortcuts, screen-reader labels, high contrast, text sizing, and reduced motion.

**Important:** Chat, unmute, and question rules are currently client-side. Only the video-visibility rule is structural in the described connection design. Do not describe client-side checks as secure backend enforcement.

## 4. What makes MeetSentra different?

The main idea is not simply another video-call interface. It is to combine:

- **A host-focused Lecture Mode** for teaching and presentations
- **Low-pressure participant feedback** so people can ask for clarification without interrupting
- **Privacy-conscious engagement awareness** that is optional and treated as an imperfect signal, not a judgment
- **Meeting access and moderation controls** aimed at keeping the session manageable

The most important design principle is that engagement estimates should never be treated as proof that someone is inattentive. Camera angle, lighting, disability, note-taking, network quality, and personal circumstances can all affect visual signals. Participants should have meaningful choices, and anonymous feedback should not expose who submitted it.

## 5. Technology and repository

The repository contains HTML, CSS, and JavaScript files, a `schema.sql` file, a `moderation.js` module, and an `engine/` directory with engagement-related modules and tests. The meeting code imports Supabase's JavaScript client and uses PeerJS-related meeting functionality. The project also references MediaPipe/client-side signals.

### Main files

- `index.html` — dashboard and meeting entry interface
- `app.js` — dashboard interactions and data operations
- `meeting.html` — meeting page structure
- `meeting.js` — meeting behavior and client-side logic
- `moderation.js` — rule-based chat moderation logic
- `schema.sql` — database schema
- `config.js` — client configuration; use only public client credentials here
- `engine/clientSignals.js` — client-side signal processing
- `engine/engagementEngine.js` — engagement state/logic
- `engine/spoofDetector.js` and `engine/spoofWorker.js` — related detection experiments
- `engine/test.mjs` — tests, if run and passing in the submitted version
- `style.css` — visual styling

**Security note:** Never commit a Supabase `service_role` key, private API key, or other secret. Browser code should use only a public/anon key with suitable database Row Level Security (RLS) policies. A client-side UI check alone is not sufficient to secure meeting access.

## 6. Hackathon journey — phase by phase

Grevix AfterCode 2026 was structured as a 24-hour online hackathon with changing Challenge Cards. The phases below describe the project journey and the work evidenced in the current project context. Add commit links, timestamps, and screenshots from your actual work where possible.

### Phase 1 — Ignition: idea and foundation

**Goal:** Define a meaningful problem and turn it into a project that could be demonstrated within a short time.

I chose the problem of online meetings that need both stronger access controls and better awareness of participant needs. I named the project MeetSentra and established the tagline, **“Smarter Meetings. Safer Connections.”**

The initial scope combined meeting creation, username invitations, moderation, optional engagement signals, and a participant feedback pulse. I created the repository and began assembling the HTML/CSS/JavaScript app, database schema, and client-side modules.

**Outcome:** A project structure and an initial dashboard/meeting prototype. The end-to-end behavior still needed validation.

### Phase 2 — Challenge Card 1: build and adapt

**Goal:** Continue implementation in response to the first challenge card.

I worked on the dashboard, meeting setup, client configuration, database integration, meeting page, moderation module, and engagement-related code. The project repository contains the relevant source files.

**What I learned:** A visible interface is only one part of a working product. Authentication, database relationships, permissions, realtime behavior, camera access, and multi-user video must all work together.

**Outcome:** A more complete codebase and a deployable prototype, but some critical flows still required debugging and verification.

> Add the exact Challenge Card 1 wording and list the specific changes you made in response to it. Do not guess the challenge text.

### Phase 3 — Challenge Card 2: real-world feedback

**Goal:** Gather genuine feedback, identify useful improvements, implement at least one change, and document the evidence.

I shared MeetSentra with people through WhatsApp and received the written responses below. The attached screenshots preserve the original messages. The feedback was positive about the goal of safer, more productive meetings, and it also pointed to practical improvements.

#### Feedback themes and response

| Feedback source | Feedback received | Product implication |
|---|---|---|
| Reviewer 1 (WhatsApp screenshot) | Liked that MeetSentra focuses on making online meetings safer and easier for everyone. Suggested meeting summaries and a way for hosts to understand participant feedback. Said secure meeting access would be most useful because it can help prevent unwanted participants from joining. | Keep secure access central; make participant feedback and host visibility easier to understand. Meeting summaries remain future work unless implemented separately. |
| Reviewer 2 (WhatsApp screenshot) | Liked the idea because it makes online meetings safer and more productive. Suggested improving the user interface and adding simple ways to collect participant feedback. Chose chat moderation as the most useful feature because it helps keep meetings safe and respectful. | Prioritize clear settings and simple participant/host interaction; retain chat moderation while being transparent about its client-side limitations. |

The screenshots supplied for this README show two distinct written feedback responses. They are evidence of feedback received, not evidence that the reviewers tested every feature in the live application.

#### Improvements made after feedback

The latest build adds a set of clearer classroom and participant controls:

- Separate **Class Settings** for the host and **My Settings** for all participants.
- **Request to speak** with a host-managed queue and floor handover.
- An **anonymous question box** with upvoting and host moderation.
- Lecture Mode and participant-controlled video visibility options.
- Accessibility controls for text size, high contrast, reduced motion, keyboard shortcuts, and screen-reader labels.

These changes address the reviewers' themes around clearer controls, collecting participant input, and safer meetings. This is a design/implementation mapping, not a claim that the reviewers themselves tested or approved these new features. Meeting summaries were suggested but are not listed as implemented.

#### Evidence and testing

- Preserve the original WhatsApp screenshots in a `feedback/` folder in the repository before submission.
- Link each screenshot from this section once it has been added to the repository.
- The developer reports that simulated tests passed for the connection logic, speaking queue, question box, settings screens, and earlier test suites.
- **Real-phone testing is still outstanding.** The next test should use three phones: one host and two students, focusing especially on settings and live-video floor handover.

### Phase 4 — Final Forge: submission and reflection

**Goal:** Stabilize the prototype, document limitations, prepare the demo, and submit the project.

The final submission should include:
- A working demo link or a clear explanation of deployment limitations
- A short walkthrough of the flows that actually work
- The README and source code
- Genuine feedback evidence and a real feedback-driven change
- Known limitations and future work
- A clear record of which features are complete, partial, or planned

**Outcome:** The project has a public repository and the intended demo URL is https://meetsentra.vercel.app/. Confirm the live deployment matches the final commit before submission. The new classroom/accessibility features have passed simulated tests but have not yet been tested on real phones.

## 7. Development struggles and how I approached them

This section records issues visible during development rather than claiming they were all fixed.

### 7.1 Database relationship error

The dashboard showed a Supabase error stating that it could not embed `profiles` with `meetings` because more than one relationship was found. This indicated that the query needed an explicit relationship or alias matching the actual foreign-key schema.

**Next step:** inspect `schema.sql`, identify the exact foreign-key names, update the query, and test invitations with separate user accounts.

### 7.2 Meeting screen and media behavior

A screenshot of the meeting page showed the “Meeting” heading and “Leave” button but no visible participant video. That meant the live meeting flow could not be considered verified from that screenshot alone.

**Next step:** test the join gate, camera/microphone permission request, PeerJS connection, network/firewall behavior, and error messages in two separate browser sessions. Confirm whether both participants can see and hear one another.

### 7.3 Deployment constraints

An earlier Netlify deployment encountered operational-credit limits. The current official demo URL is https://meetsentra.vercel.app/. The deployed build has not been independently verified in this README update, so confirm it loads and matches the final repository commit before submission.

**Next step:** open the official Vercel demo, test the latest features, and confirm the deployed version matches the repository commit. Do not claim that the live site contains changes that were not successfully deployed.

### 7.4 A short hackathon deadline

The 24-hour format required balancing a broad idea against the time available to implement and test it. The key lesson was to prioritize a small number of meaningful, demonstrable flows instead of counting every planned feature as finished.

## 8. Demo plan

Use only steps that work on the final build. If a step fails, show the limitation honestly.

1. Sign in and open the dashboard.
2. Create a meeting and explain the available invitation controls.
3. Join from a second account/browser if multi-user joining works.
4. Demonstrate live audio/video only if it is functioning.
5. Show the actual chat moderation behavior with a harmless test case.
6. Demonstrate Meeting Pulse or Lecture Mode only if implemented and tested.
7. Explain how privacy/consent works and what data is sent or stored.
8. Show one genuine feedback-driven improvement and the associated commit.
9. Finish with known limitations and next steps.

## 9. Testing checklist

- [ ] Sign-up/login succeeds in a fresh browser session
- [ ] Meeting creation succeeds and persists
- [ ] Invitations appear for the intended account
- [ ] A non-invited account is denied by server/database rules, not only hidden UI
- [ ] Two separate users can join the same meeting
- [ ] Camera/microphone permissions are requested at the appropriate time
- [ ] Audio/video work or the limitation is clearly disclosed
- [ ] Chat moderation allows normal text and handles flagged text as expected
- [ ] Host controls work for another participant
- [ ] Any engagement signal requires consent and is described as approximate
- [ ] Anonymous pulse does not expose the submitter
- [ ] Mobile layout and permission/error messages are usable
- [ ] No secret keys are committed
- [ ] The deployed site matches the submitted commit
- [ ] At least one genuine feedback-based improvement is tested

## 10. Known limitations and future work

Potential next steps, depending on the final build:

- Fix and test database relationship queries and invitation access checks
- Stabilize multi-user audio/video and reconnect/error handling
- Test Lecture Mode and host-controlled participant visibility on real phones, including floor handover
- Improve mobile onboarding and permission explanations
- Make Meeting Pulse anonymous by design and clearly aggregate responses
- Validate the engagement model across lighting, camera, and accessibility conditions
- Move chat, microphone, and question permissions to server-side enforcement where required; add transparent moderation explanations and review controls
- Add persistent meeting recaps, persistent question/speaking queues, captions, and stronger host roles

These are future-work items unless the final submitted version demonstrates otherwise.

## 11. What I learned

This hackathon was a lesson in moving from an idea to a prototype under a strict time limit. I had to think about product design, frontend behavior, database integration, permissions, deployment, debugging, and how to explain the project clearly. The most useful lesson was that a feature is not finished just because its interface exists: it needs to work, be tested, and be described honestly.

I am treating MeetSentra as an evolving prototype. The goal is not to claim a perfect video platform in one day, but to explore a useful direction for safer, more participant-aware meetings and improve it through real feedback.

## 12. Credits and responsible use

- **Project:** MeetSentra
- **Event:** Grevix AfterCode 2026
- **Builder:** [Add your preferred name]
- **Repository:** https://github.com/pardhasaradhikilli/Grevix_meetsentra_project
- **Demo:** https://meetsentra.vercel.app/

List any libraries, APIs, AI coding assistants, or external services used in the final version here. Explain their role accurately and do not claim a model or service was used if it was not.

## 13. Final submission summary

MeetSentra explores how an online meeting tool can combine controlled access, moderation, lecture-focused video visibility, accessible participant settings, requests to speak, and anonymous questions. Feedback from two reviewers reinforced the importance of secure access, clearer UI, participant feedback, and chat moderation. In response, the prototype now includes classroom controls and accessibility additions that have passed simulated tests. The next priority is real-phone testing, stronger server-side enforcement where needed, and confirming the deployed demo matches the submitted code.

**Final status:** Classroom settings, Lecture Mode connection logic, speaking queue, anonymous questions, and accessibility basics have been added and passed simulated tests. Real-phone testing is still required; the host-browser queue/questions are not persistent, and chat/unmute/question rules are not backend-enforced.
