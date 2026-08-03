# Olympus — Frost Competency Evidence Pipeline — BRD v1.0
Signed-off source for the Spec Kit specify step. Preserve every ID.
Open decisions OD-1..OD-4 stay [NEEDS CLARIFICATION]; do not
resolve them. Scope is v1 only. Do not add features, personas, or
user stories this document does not contain.

## 1. Problem & goals

Sheet-based competency capture is accurate but gruelling; adoption
suffers and the founder's judgment doesn't scale. Goal: talent
describes work in plain language; AI structures it into evidence
claims against the established model; validation routes to
non-advocates automatically. Success criteria: (G1) minutes not
hours, any language; (G2) guided input, guarded output a
non-advocate can validate; (G3) intuitive fixed questions, no
schema exposed to the talent.

## 2. Personas

- P-1 Talent (Ops or Art & Asset track): files evidence cards.
- P-2 Lead: approves nominee exposure; opens card shells; writes
  the Part 4 reading; sees reports' confirmed records.
- P-3 Non-advocate: validates routed cards (Confirmed/Adjust).
- P-4 Admin (JP): calibration review, vocab versioning, user/track
  admin. No verdict rights (Invariant 3).

## 3. Functional requirements

Capture
- FR-1: Talent signs in with Frost Google Workspace account;
  domain-restricted.
- FR-2: Home shows ladder position, confirmed cards, draft list,
  Start a card.
- FR-3: Card start displays the track's four fixed questions
  upfront (exact text: Implementation Plan §5). Two answer modes:
  guided chat (one at a time) and single-pass (one dump). Any
  language.
- FR-4: Drafts autosave; talent can hold multiple drafts; cards
  are per account (Ops) / per project (A&A) with close date; period
  tag = quarter of close date regardless of filing date.
- FR-5: A lead can open a card shell for a report containing
  project/account name and close date only — no content.
- FR-6: Prior confirmed cards render as context above the input;
  never inside any answer field (Invariant 11).

Structuring
- FR-7: On submit, backend calls the Anthropic API with the track's
  versioned vocabulary pack (Ops v0.2 / A&A v0.3, ported verbatim)
  plus raw answers; returns drafted claims per the card schema.
- FR-8: One coverage sweep message after the four answers, covering
  unmentioned competencies/domains; "not me" is a costless answer;
  sweep is exempt from the follow-up limit.
- FR-9: Maximum two clarification follow-ups per card, only for
  unmappable input.
- FR-10: Server validation layer rejects any claim label not in the
  track's controlled vocabulary (Invariant 10).
- FR-11: Calibration mode: while active per track, structured cards
  queue to Admin for review before the talent sees them;
  corrections logged; mode exits on the gate in Plan §8.

Confirm & nominate
- FR-12: Confirm screen shows each claim with its exact label,
  source quote, and flags rendered as plain-language nudges; talent
  approves or fixes per line; edits re-run FR-10 validation.
- FR-13: Talent nominates 1–2 confirmers ("exposed to the work but
  not your Lead"); system checks (a) advocate block — nominee is
  not the lead, endorser, or a named call-maker on the card;
  (b) exposure — nominee attached to the same account/project.
  Failed check returns the pick to the talent with the reason.
- FR-14: Lead approves or rejects the nominee with a required
  reason; rejection returns to talent; no substitution
  (Invariant 4).
- FR-15: Thin pool: when no valid nominee exists, route to the
  track's fallback reviewer, visibly marked as the exception path
  (fallback names: OD-2).

Routing & verdicts
- FR-16: Approved cards route to the nominee's queue; reviewer sees
  claims, quotes, flags, and STALE context; actions: Confirmed, or
  Adjust with required note. Adjust returns to talent; revised card
  re-routes.
- FR-17: Repeat-reviewer flag: the same reviewer 3+ consecutive
  times for one talent surfaces a rotation prompt to the lead at
  approval time; prompt, not block.

Reading & assembly
- FR-18: Level derivation runs server-side from confirmed claims
  only, using each track's existing logic ported from the live
  sheets (Ops execution×decision scoring; A&A Levels-table pair
  with Early/Settled/Late texture). Sheets remain the reference
  implementation for acceptance.
- FR-19: Talent home shows current read, texture, evidence mapped
  on the ladder, and their honest gap in their own words only.
- FR-20: Quarterly view: read-only assembly of confirmed cards by
  period tag; per person (talent scope) and per team (lead/admin
  scope).
- FR-21: Nudges: project/account closed 30+ days with no card
  started → gentle prompt to talent; leads get a "no recent
  evidence" visibility list; never a penalty, never auto-creates
  content.
- FR-22: Nightly one-way export of confirmed cards into the
  existing per-track Sheets instrument format.

## 4. Business rules

- BR-1: Ambiguity defaults down with visible flag (Invariant 6).
  Flag vocabulary is fixed per pack: NEEDS-OWNER, COULD-BE-HIGHER,
  NEEDS-2A, NEEDS-INVOLVEMENT, FLOOR-BLOCKS-CLIMB, STALE,
  PROPOSED-BOLT-IN, THIN-POOL, NOT-TRIGGERED, NOT-CLAIMED.
- BR-2: Silence and ownership-less mentions map to NOT-CLAIMED
  (Invariant 7).
- BR-3: Effort/volume/size never persist as claim content
  (Invariant 8).
- BR-4: Cards filed 60+ days after close carry STALE — context for
  the reviewer, never a block.
- BR-5: A&A only: floor below "goes out as is" voids direction
  claims on that project (FLOOR-BLOCKS-CLIMB); rung 4+ requires
  Part 2a from-scratch material; GCash Design Support can never
  yield rung 4+.
- BR-6: Ops only: "proposed and approved" maps to "I proposed and
  someone decided" and is never upgraded; resiliency entries keep
  honest decision states even when that reads "Call not owned."
- BR-7: Confirmed is the only accepting verdict; Adjust requires
  revision and re-review.
- BR-8: Proposed bolt-ins outside the recognized list are flagged,
  never slotted.

## 5. Non-functional requirements

- NFR-1: All role permissions enforced server-side (Invariant 16);
  role matrix in Plan §4.
- NFR-2: Append-only audit log on every state change and verdict
  (Invariant 17).
- NFR-3: Raw answers persist before structuring; AI/network failure
  is retryable with no input loss (Invariant 15).
- NFR-4: Anthropic API key server-side only.
- NFR-5: Timezone Asia/Manila for all dates and period tags.
- NFR-6: No ranking or people-comparison views (Invariant 12).
- NFR-7: Vocab packs immutable and versioned per card
  (Invariant 1).

## 6. Acceptance criteria

- AC-1: Permission matrix test: every forbidden write in Plan §4 is
  rejected server-side, including admin writing a verdict.
- AC-2: Karen Ong's confirmed Ops record reproduces exactly through
  the app path (derivation parity with her live sheet).
- AC-3: Gwyn Cristo's confirmed A&A record reproduces exactly,
  including her disqualified direction entries staying disqualified
  and Adjust feedback outcomes matching.
- AC-4: Zero-inflation diff: for benchmark inputs, no app-produced
  claim exceeds the confirmed sheet record.
- AC-5: Trap-input suite passes: effort bragging, missing call
  owner, from-scratch claims inside GCash, proposed-as-decided,
  revision-as-refinement — each produces the correct lower claim,
  flag, or follow-up, never an inflated claim.
- AC-6: Silence test: a capture omitting a competency yields
  NOT-CLAIMED, no state, no visible gap.
- AC-7: A talent's card is invisible to other talents; a
  non-advocate sees only cards routed to them.
- AC-8: Kill the AI mid-structuring: raw answers intact, retry
  succeeds.
- AC-9: Calibration gate (JP-owned): 5 consecutive zero-correction
  cards across 3 talents per track before calibration mode exits.
- AC-10: Sheets export round-trip: exported card is readable in the
  existing instrument format with all claims, quotes, and verdicts
  intact.

## 7. Out of scope (v1)

Compensation/raise logic; coaching prompt instrument; editing the
competency model from the app; analytics beyond card/status counts;
new tracks beyond Ops and A&A (data model must not preclude them);
mobile-native clients (responsive web only).

## 8. Open decisions

- OD-1 [NEEDS CLARIFICATION]: Ares integration surface — shared
  server only, or shared auth/session/user store with Ares?
- OD-2 [NEEDS CLARIFICATION]: Fallback reviewers per track
  (suggested Miles/Ops, Gwyn/A&A).
- OD-3 [NEEDS CLARIFICATION]: Whether rung crossings ever touch
  comp — explicitly out of build scope; recorded for traceability.
- OD-4 [NEEDS CLARIFICATION]: STALE (60d) and nudge (30d)
  thresholds — defaults set, tune after first quarter.
