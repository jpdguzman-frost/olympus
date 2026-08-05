# Olympus — B7 · Conversational Capture Spec

Date: Aug 5, 2026 · Status: PENDING JP APPROVAL — no build until approved.
Source: JP's walkthrough feedback (5 points) + 4 ratified follow-up answers.
Governed by Amendment 1 + Rulings; invariants in force; verdict
sovereignty untouched. NOTE: this spec SUPERSEDES Ruling C7 (two answer
modes) — JP's direction, Aug 5: one flow only.

---

## 1. Home: projects up front (kills "Catch up")

- The talent's home leads with **"Your projects"**: every uncarded CAPS
  project listed directly — name + tenure ("you were on it Jan – Jul") —
  each with one button: **File this project**.
- Below it: **"File something else"** for work not in CAPS (opens the
  same conversation, no scaffold). CAPS is an accelerator, never a gate.
- The "Catch up" button, the date-range screen, and the term die.
- Drafts / In flight / On record / Ladder sections unchanged below.

## 2. The activity summary (on picking a project)

- Before the conversation starts, the AI builds a short summary of what
  the talent did on that project, from the CAPS scaffold: a neutral
  opening paragraph + activities grouped by kind, with task names and
  dates. **The card name is the work — no links, no descriptions exist
  behind them (JP). The A2 whitelist stays exactly as is.**
- NEVER a count or total ("47 tasks") — volume is a banned statistic.
  Kinds, names, and the time span only.
- Cached per (talent, project); rebuilt when a new CAPS batch imports.
- The summary shows to the talent for clarity AND feeds the
  conversation as context. It is memory, never evidence.

## 3. The conversation (replaces the form and both modes)

- **One question at a time.** No mode toggle, no four-questions-upfront
  display, no answer-style choice. If the talent pastes everything in
  one go, the AI simply continues from it — a behavior, not a mode.
- **Voice (JP, verbatim direction):** English. Approachable yet
  professional. Simple words. Don't hype things up; stay neutral.
- **Skeleton:** the four fixed questions become the INVISIBLE coverage
  backbone — the AI must cover their intent (what work + since when ·
  run-alone vs checked · calls made alone vs by others · what broke or
  changed) but words every turn itself and adapts each next question to
  the last answer, nudging toward what the model needs: the date/account
  anchor, the call-owner, and the 3 upgrade elements when something
  reads above its anchor. Budgets per Intent v2: 1 anchor + max 2
  clarifiers per touched row.
- **Completeness:** the AI tracks skeleton coverage. When covered (or
  budget spent), it runs the sweep — one compact message, every "yes"
  gets one detail invite — then says plainly it has what it needs.
  The talent can also stop at ANY time ("Send what we have"); rows
  without enough detail stay "insufficient detail — draft". Never
  trapped, never interrogated.
- **Turn cap:** 12 AI questions per card, hard stop → wrap with what's
  there. (Tunable; JP may adjust at approval.)
- **Recording (Invariant 15):** every talent turn persists verbatim as
  raw answers the moment it's sent; AI turns persist as transcript.
  Claims and quotes may only ever come from TALENT turns — the FR-10
  verbatim check runs against talent text alone.
- **Invariant 10:** the conversation never states a level, a reading,
  or a readiness opinion — same structural exclusion as structuring.
- **Engine:** each AI turn is one API call — system prompt = behavior
  spec + pack §B/§C (as today) + a mechanical conversation frame;
  input = activity summary + transcript so far; forced JSON output =
  { nextQuestion | done, coveredTopics }. Typing indicator; 2–6s/turn.
- **Behavior text:** the questioning policy belongs in the BEHAVIOR
  SPEC (versioned data, never hard-coded). I draft a "conversation
  mode" addendum as v2.1-calibrating; JP reviews and publishes it —
  same GATE-1 verbatim-port rule applies.

## 4. After the conversation — unchanged

Send it in → structuring (input = full transcript + summary) →
calibration hold → confirm screen exactly as built: anchors, "Because
you said:", re-check, approve per line, pick one confirmer, sign-off
or auto-verify, verdicts. Nothing downstream changes.

## 5. What dies

Guided/single-pass toggle · "Catch up" term and screen · the
four-questions-upfront blocks · FR-3's presentation (its four
questions survive as the skeleton) · Ruling C7's two-mode survival
(superseded by JP's Aug 5 direction).

## 6. Build order + estimates

1. Summary service + home project list (1d)
2. Conversation engine + chat UI + transcript persistence (2–3d)
3. Behavior-spec conversation addendum (draft for JP) + wiring (0.5d)
4. Tests: coverage engine (mocked), turn caps, talent-only quote
   sourcing, transcript persistence, summary has no volume stats (1d)

~4–5 dev-days. Calibration comparability note: cards filed through the
conversation carry captureMode 'conversation' so JP can tell them
apart from pre-B7 cards.

## 7. JP decisions inside this spec

1. Approve the spec (includes the C7 supersession).
2. Turn cap: 12 all right, or another number?
3. The behavior-spec addendum text: I draft, you edit/publish — or you
   write it yourself.
