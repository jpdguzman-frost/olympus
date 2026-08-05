# Olympus — Intake Amendment 1
Date: Aug 5, 2026 · Author: JP · Status: Ratified
Amends: Olympus__CLAUDE.md, Olympus__BRD.md (v1.0),
Olympus__Implementation_Plan.md (all dated Aug 3, 2026).
Where this amendment conflicts with those documents, this amendment
wins. All 17 invariants remain in force except as amended below.

---

## A1. Lead approval REMOVED from the validation chain

The flow capture → structure → talent confirm → nominee → LEAD
APPROVAL → non-advocate verdict is superseded. Leads no longer
approve exposure. Replacement:

- Talent nominates their non-advocate per card (unchanged: nominees
  cannot be substituted by anyone).
- Exposure is auto-verified from CAPS: the nominee qualifies if their
  logged reviews of the talent's work span 3+ separate weeks on that
  project (threshold tunable post-pilot).
- Below threshold or no CAPS record: nomination routes to Miles (Ops)
  or Don (A&A-side accounts) for a one-line exposure sign-off. This
  is exposure verification only — never verdict authority, never
  substitution.
- Lead visibility: Miles and Don only, read-only, scoped to their own
  people. No other lead access. The system chases non-advocates
  directly.

## A2. NEW integration — CAPS / Raintool (read-only)

- The app reads CAPS for: task names, task categories, project
  assignments, reviewer identities, leadership weeks, and task dates.
- HARD WALL (new invariant-level rule): CAPS value scores, pace
  metrics, peer bands, and any volume statistic never reach a card,
  a claim, a prompt, or any talent-facing or assessor-facing view.
  Review count is never treated as review authority.
- CAPS data is a memory scaffold and verification source, never
  evidence. No CAPS data → capture falls back to the plain four
  questions. CAPS is an accelerator, never a gate.

## A3. Capture redesign — two doors, per-project cards

- Door 1 "File a project": talent files at project close. Default.
- Door 2 "Catch up": date-range entry screen listing the talent's
  CAPS projects with no card yet. Each pick opens the same
  per-project flow. Range-pull is navigation, never a capture mode.
- Capture behavior (propose-don't-interrogate, question budget,
  3-element upgrade standard, two-way flag duty, sweep detail rule,
  prior-record memory prompts, design/run probe) is defined in
  Olympus__M0_Intent_v2.md — see A7.

## A4. NEW card mechanics

- Traceback: every drafted line stores the verbatim talent quote that
  produced its mapping. Schema-level, mandatory. No quote, no claim.
- Contention loop: talent contests a line against its traceback; AI
  re-maps or explains; a mapping is never final over the talent's
  objection.
- Date anchoring: no claim is confirmable without account + date or
  period. CAPS task dates may be offered as prompts.
- "Signal noted, not claimed": declined upward invitations are
  recorded on the card, visible to the non-advocate, resurfaced at
  Endorsement Review.
- Drafts: private to the talent, archived (never deleted) at 90 days
  with one pre-expiry nudge; revivable from archive.
- Talent-facing language never blames: "needs a date," "kept as
  draft," "add anytime" — internal flag vocabulary is not shown raw.

## A5. Verdict mechanics

- Attestation: "Confirmed" requires one line stating what the
  non-advocate checked. Stored, auditable, spot-checkable.
- SLA: 10 working days, two automatic chases, then auto-escalation to
  the fallback reviewer per track. Non-response is never a verdict.
- JP dashboard: all cards pending verdict, assigned nominee, aging in
  days, chase count. JP may nudge manually at any time.
- Deadlock (talent defends, non-advocate holds): escalates to JP as
  non-partisan judge; both final positions logged permanently.
- NEW verdict-adjacent state: "Confirmed — packaging deferred."
  Endorsement Review may defer compensation packaging for commercial
  timing; the confirmed level is always recorded and never erased.

## A6. Vocabulary changes (Design Ops track)

- The Design Ops sheet is being RETIRED. Olympus__Pack_Ops_v0.4.md is
  now the canonical Ops vocabulary. Changes are versioned and
  JP-approved only. Packs remain immutable per card (unchanged).
- New Part 2 gate: "Ops systems design" — RAMP. Event-based: a
  structure designed from a blank slate against the onboarding brief.
  Absence is never a gap; a try is not a hold (lifts only if the
  project ran on the structure). New flags: "not yet reached — not a
  gap," "designed, not held — doesn't lift level."
- Derivation formula: with the sheet retiring, the level-derivation
  logic needs a new authoritative home inside the app before M4.
  OPEN ITEM — added to BRD open decisions.

## A7. Authoritative artifacts (supersedes prior pack references)

- Behavior: Olympus__M0_Intent_v2.md — all AI capture/structuring
  behavior. STATUS: CALIBRATING. Build the pipeline around it; do not
  hard-code its text. Port verbatim at GATE-1 (5 consecutive clean
  cards across Karen, Jacob, Gwyn).
- Vocabulary/schema: Olympus__Pack_Ops_v0.4.md (canonical, versioned).
  A&A pack v0.4 to follow; until then the A&A sheet remains that
  track's reference.
- The Aug 3 prompt packs (Ops v0.2, A&A v0.3) are superseded for Ops;
  do not copy v0.2 into the repo.

## A8. Unchanged and reaffirmed

Verdict sovereignty (only the assigned non-advocate writes a verdict,
admin included). AI never scores, levels, or uses promotion language.
Evidence-only; no ratings. Default-down with flags. No analytics that
rank people. Ares stack parity. Asia/Manila timezone. Sheets export
continues until sheet retirement is complete, then becomes archive
export only.
