# Olympus — Session Handoff (2026-08-06)

Read this + `CLAUDE.md` (reply format, verbatim-critical) to resume.

## Governance chain (precedence, top wins)

1. 17 invariants (`Olympus__CLAUDE.md`) — Constitution v2 issues at
   GATE-1 (adds the CAPS wall as Invariant 18; rewrites Invariant 4
   per A1/C3). Do NOT edit the constitution file before then.
2. `Olympus__Intake_Amendment_1.md` (ratified Aug 5) +
   `Olympus__Rulings_2026-08-05.md` (C1–C9, OD-2) +
   `Olympus__B7_Conversational_Capture_Spec.md` (approved Aug 5;
   SUPERSEDES ruling C7 — one capture flow only).
3. Aug 3 BRD/Plan where not amended.
- Behavior: `Olympus__M0_Intent_v2.md` — CALIBRATING, stored as
  versioned DATA (behavior_spec_versions), NEVER hard-coded; verbatim
  port at GATE-1. Agent-drafted conversation addendum awaiting JP:
  `Olympus__M0_Intent_v2.1_Conversation_DRAFT.md` (UNPUBLISHED).
- Vocabulary: `Olympus__Pack_Ops_v0.4.md` canonical (sheet retired;
  v0.2 deleted). A&A: sheet remains reference until A&A pack v0.4.

## Build state — ALL packages DONE, 183/183 tests, pushed to main

B1 pack split + role settings (7197cca) · B2 verdict mechanics/C1
deadlock/SLA/JP dashboard (d8982fa) · B3 nomination rework/sign-off
(20e71d6) · B4 anchoring/contention/signals/lifecycle (aa65d72) ·
B5 CAPS CSV wall (27bf9e5) · B6 two doors → superseded by ·
B7 conversational capture (24d3b9d) + fixes through 39b39e3.
`Olympus__Build_Change_Plan_v1.md` has per-package detail.

## The amended flow (as built)

Home lists talent's uncarded CAPS projects (+ "File something else")
→ AI activity summary (cached; names/dates, NEVER counts) → Socratic
one-question-at-a-time capture (Sonnet 5; skeleton = the 4 questions'
intent; early wrap, 12-cap; post-wrap additions allowed; every talent
turn persists verbatim PRE-AI-call; AI turns can never be quoted —
structural) → structuring (Opus 5; anchor+signals in schema; collapse
rescue = one retry with minimal talent-words render) → calibration
hold (JP releases; corrections counted; clean-streak meter vs
5-across-3; correction log = Pack §E feed, append-only audit_logs in
MongoDB) → talent confirm (anchor gate "needs a date"; THIN-LINE RULE:
'insufficient detail — draft' lines can't be approved/defended/fixed —
add-detail re-checks via contention loop, or leave as costless draft;
partial approval routes only approved lines, drafts invisible to
reviewer, take no verdict, don't block confirm) → pick ONE confirmer
(C2; rotation advisory C5) → CAPS auto-verify (3+ distinct review
weeks) else exposure-verifier sign-off (C3 refusal returns pick) →
verdict w/ required attestation → Adjust→defend→deadlock→JP ruling
(guidance, never a verdict)→reviewer decides or refuses→fallback
(OD-2 setting, exclusions, halts visibly) → SLA 10wd/2 chases.
Leadership weeks ON HOLD (JP) — project tenure instead.

## Models & infra

- Conversation + summary: `claude-sonnet-5` (CONVERSATION_MODEL).
  Structuring + remap: `claude-opus-5` (STRUCTURER_MODEL).
- Prompt caching ON (system + conversation prefix blocks).
- Workers: structurer+contention (15s), SLA (hourly), lifecycle (6h).
- Scripts: `npm run import-caps -- <csv>` · `load-behavior-spec` ·
  `load-packs` · seed/build/test as before. Server port 4600.

## Dev environment right now

- CAPS: 23,080 rows imported (H1 2026); admin shows batch. Wall test
  class = capsWall.test.js.
- Mappings: dev-karen→Karen Ong · dev-gwyn→Gwyn Cristo · dev-jacob→
  Jacob · dev-reviewer→Lea Villanueva (auto-verify demo: Gwyn +
  GCash App + Reviewer). Verifier+fallback = Dev Lead, both tracks.
- Karen was wiped (JP request), then filed ONE conversation card:
  GCash App — in JP's calibration queue with 6 claims + 2 signals,
  two lines thin-flagged (good demo of the new rule). Jacob's GCash
  card also held. JP is mid talent-walkthrough.
- API credits were topped up Aug 6 after running dry mid-test.

## Live structurer findings (calibration inputs, keep!)

- Collapse causes proven by bisection: (a) zero time-words in
  evidence, (b) meta-lines like "This is good enough." Frame now
  forbids placeholder rows + skips meta-lines; rescue retry covers
  the rest. JP's real cards = best trap inputs so far.
- Standing structurer rulings for JP's calibration: coverage rows for
  unmentioned competencies ('not yet reached — not a gap' as claim
  rows) vs Invariant 7; duplicate same-competency rows; Taglish quote
  paraphrase (FR-10 drops those — behavior tuning matter).

## Waiting on JP

1. Calibrate + release the two held cards (thin-line UX demo inside).
2. Publish behavior addendum v2.1 (edit the DRAFT, then
   `npm run load-behavior-spec -- ops v2.1-calibrating <file>`).
3. Pre-amendment items still open: A&A pack v0.4 delivery; Cascade
   contradiction; GATE-2 parity confirms; OD-1; OD-3; OD-4 tuning;
   OD-5 (derivation home — recommended: pack appendix; before M4=P5
   per ratified C8 map); OAuth creds; real users at pilot.

## Working agreement (unchanged, verbatim-critical)

HEADLINE / WHAT I NEED FROM YOU / STATUS ≤5 / DETAIL under `---`.
[sure]/[likely]/[guess]. J1-simple copy everywhere; describe by what
happens, never role titles; pack vocabulary verbatim (Invariant 1).
Judgment-free work runs autonomously; JP-judgment items batched.
Commits: conventional + Claude co-author trailer, push to main.

## Immediate next actions on resume

1. JP continues the talent walkthrough — fix what he hits, his
   feedback rules over everything generated.
2. If he says "fold corrections in": draft behavior-rule amendments
   from the correction log for his approval.
3. Still unbuilt from the ORIGINAL plan: P6 exporter (FR-22, now
   archive-mode per A8) + nudges (FR-21) — blocked by GATE-2.
