# Olympus — Session Handoff (2026-08-06, post-C2v2 rebuild)

Read this + `CLAUDE.md` (reply format, verbatim-critical) to resume.

## Governance chain (precedence, top wins)

1. 17 invariants (`Olympus__CLAUDE.md`) — Constitution v2 issues at
   GATE-1 (adds the CAPS wall as Invariant 18; rewrites Invariant 4
   per A1/C3). Do NOT edit the constitution file before then.
2. `Olympus__Intake_Amendment_1.md` (ratified Aug 5) +
   `Olympus__Rulings_2026-08-05.md` — WHICH NOW CARRIES the Aug 6
   addendum: **C2v2** (per-line checkers, supersedes C2), **DS-1**
   (document screen, one read one send), **DS-2** (full bolt-in list +
   signal claiming), **SC-1** (spot-check replaces the calibration
   hold; the fix window), **SUM-1** (scannable summary) +
   `Olympus__B7_Conversational_Capture_Spec.md` (supersedes C7).
3. Aug 3 BRD/Plan where not amended.
- Behavior: `Olympus__M0_Intent_v2.md` — CALIBRATING, versioned DATA,
  never hard-coded. Agent-drafted conversation addendum awaiting JP:
  `Olympus__M0_Intent_v2.1_Conversation_DRAFT.md` (UNPUBLISHED; now
  includes the agent-drafted "ask for the when in the room" rule).

## Build state — B1–B7 + the Aug 6 C2v2 rebuild. 188/188 tests.

The Aug 6 rebuild (JP's walkthrough verdict: old confirm flow "worse
than the form") replaced the entire post-structuring talent
experience:

- **Document screen** (`detail.html` rewritten): every line shows
  labels, verbatim quote IN its conversation context, a one-sentence
  `rationale` ("how we read it"), and `missingPiece` on evidence-gated
  lines. Reading is the review; ONE send is the approval (per-line
  `talentApproved` still recorded at send — Invariant 5 intact). Undo
  (leave-out toggle) until send. Dispute controls only post-Adjust.
- **Per-line threads** (`conversationService.lineThread`, Sonnet):
  clarify/argue/back-up a line in place; words persist verbatim into
  rawAnswers PRE-AI (Invariant 15); closing opens a contention → the
  existing Opus re-map loop answers within ~1 min.
- **Bolt-ins + signals** (`boltInThread` + `runBoltInPass` in the
  structurer worker + `draftBoltInLine`): full Part-3 list always
  shown (ops track.boltIns, 6 entries, loaded from the vocab sidecar);
  tap → contextual thread → worker drafts the line through FR-10.
  Claimed signals leave signalsNoted.
- **Per-line checker fan-out (C2v2)**: `sendPicks` in confirmService —
  one pick covers all lines, `lineOverrides` switches single lines,
  exactly one non-advocate per line (`claims[].checkerId`), one route
  per distinct checker (`nomination.routes[]`) each with its own
  exposure check, per-pick sign-off (verifier rows per pick;
  `reviewerId` in the decide body), SLA clock, chases, and
  escalation. Verdict guard = the LINE's checker (`applyVerdict`).
  presentCard scopes a checker to their lines only. Legacy
  `routedTo` cards still work everywhere (fallback paths kept).
- **Spot-check replaces the hold (SC-1)**: structured cards go
  straight to the talent; admin "calibration" endpoints now serve the
  spot-check list. FIX WINDOW enforced in `calibrationService`:
  pre-send silent · post-send/pre-checker pulls the line back
  (`needsRelook`, approval + checker cleared) · post-routing LOG-ONLY
  (`card.calibration-note` audit). Streak = cards that REACHED A
  CHECKER clean.
- **Summary reformat (SUM-1)**: opening line + 3–6 bullets; old
  cached summaries wiped (regenerate on next open).

## Models & infra (unchanged)

Conversation/summary/threads: `claude-sonnet-5`. Structuring, re-map,
bolt-in drafting: `claude-opus-5`. Prompt caching ON. Workers:
structurer+contention+bolt-in (15s), SLA (hourly, per route),
lifecycle (6h). Server port 4600 — running with all changes.

## Dev environment right now

- Users: dev-karen/dev-jacob/dev-gwyn/dev-reviewer @dev.olympus.invalid,
  JP admin. Verifier + fallback = Dev Lead (both tracks).
- Karen: GCash App card in `talent-approved` (approved under the OLD
  flow, no checker yet) → she gets the re-send path: picker + "Send it
  again". Jacob: GCash App `structured`, 2 claims — now INSTANTLY
  visible to him (hold retired); his lines predate `rationale`, so
  that block just doesn't render on them.
- ops track has boltIns (6) set; CAPS 23,080 rows loaded.

## Waiting on JP

1. Walk the new flow (talent side): document screen → threads →
   bolt-ins → one send → per-pick sign-off → per-line verdicts.
2. Publish behavior addendum v2.1 (edit DRAFT, then
   `npm run load-behavior-spec -- ops v2.1-calibrating <file>`).
3. Standing calibration items + pre-amendment list unchanged (A&A
   pack v0.4, Cascade, GATE-2 parity, OD-1/3/4/5, OAuth, pilot users).

## Immediate next actions on resume

1. JP tests end to end — fix what he hits; his feedback rules.
2. If a structured-before-rebuild card needs rationales, offer a
   re-structure (resubmit path) rather than hand-writing them.
3. Still unbuilt from the ORIGINAL plan: P6 exporter (FR-22,
   archive-mode per A8) + nudges (FR-21) — blocked by GATE-2.

## Working agreement (unchanged, verbatim-critical)

HEADLINE / WHAT I NEED FROM YOU / STATUS ≤5 / DETAIL under `---`.
[sure]/[likely]/[guess]. J1-simple copy everywhere; describe by what
happens, never role titles; pack vocabulary verbatim (Invariant 1).
Commits: conventional + Claude co-author trailer, push to main.
