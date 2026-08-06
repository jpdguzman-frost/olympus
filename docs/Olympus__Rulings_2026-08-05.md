# Olympus — Ratified Rulings C1–C9 + OD-2 · Aug 5, 2026

Transcribed from JP's ruling message of Aug 5, 2026. Status: RATIFIED.
Precedence: Amendment 1 + these rulings govern on conflict with the
Aug 3 documents. Constitution v2 issues at GATE-1 (CAPS wall →
Invariant 18; Invariant 4 rewritten per A1/C3); CLAUDE.md is not
edited until then.

## C1 — Deadlock (Invariant 3 untouched)

JP never writes a verdict. Deadlock flow:

1. JP reviews both logged positions.
2. JP writes a **ruling**, attached to the card — a ruling is
   guidance on the record, not a verdict.
3. The assigned non-advocate re-reviews with the ruling in view.
4. If they now agree, they write the verdict themselves.
5. If they still refuse, the card auto-reassigns to the track's
   fallback reviewer, who reviews and writes the verdict.

Build states: `deadlocked`, `ruled`, `reassigned`. The fallback
reviewer is resolved from the admin-assignable role setting defined
under OD-2.

## C2 — Nominee count

Exactly one nominee per card. A failed exposure check returns the
pick to the talent to nominate another.

## C3 — Exposure sign-off refusal

Miles/Don refusal returns the pick to the talent; a stated reason is
required. This is Invariant 4's rejection leg, re-homed.

## C4 — Shells and Part 4

FR-5 shells and Part 4 lead-writes are retired. Part 4's core
question — "when this person's area needed a decision, who made the
call — don't round up" — is retained as guidance text shown to
reviewers at verdict time.

## C5 — Rotation prompt

FR-17 rotation prompt moves to nomination time, talent-facing,
advisory, never blocking. Repeat-reviewer counts also surface on the
admin pending-verdict dashboard.

## C6 — Two-layer flags

Pack §B8 = claim-level flags, applied to lines. The BR-1/BR-4/FR-15
set = card/system-level context flags. Both govern; the split is
documented in the vocab sidecar.

## C7 — Answer modes

Both answer modes survive in the no-CAPS fallback — guided chat as
default, single-pass paste accepted.

## C8 — M-milestone mapping

Agent proposes the M → P mapping from the Implementation Plan's phase
contents. Constraint: OD-5 (the derivation formula's in-app home)
must close before whichever phase builds level derivation display.
The proposed map rides in the build-change plan for JP ratification —
NOT ratified until JP confirms.

## C9 — Endorsement Review scope

v1 scope = hooks only: the signals-noted resurface list and the
"Confirmed — packaging deferred" state. The Endorsement Review
workflow itself is out of build scope; it runs manually.

## OD-2 — Fallback reviewer as role setting

Do not hard-code fallback reviewer names. "Fallback reviewer" is an
admin-assignable role per track, configurable in system settings,
changeable without deploy. Constraint: a fallback reviewer can never
be assigned to a card where they are the talent, the nominee, or a
party to the deadlock. The SLA worker reads the current assignment at
escalation time. Initial assignments are set in the admin UI at
pilot, not in code.

---

# Addendum — Ratified Rulings of Aug 6, 2026

Transcribed from JP's walkthrough feedback + design session of
Aug 6, 2026 (in-session, including four AskUserQuestion decisions).
Status: RATIFIED. These govern on conflict with anything above.

## C2v2 — Per-line checkers (SUPERSEDES C2)

JP, verbatim intent: "you can send it to different people and not
only to 1 person… But one non-advocate per competency line."

- A card's lines may go to DIFFERENT checkers. Exactly ONE
  non-advocate per competency line — no line is ever judged by two.
- Picking UX (ratified): one pick covers every line; any single line
  can be switched to a different person who saw that work. Most cards
  never touch the override.
- Mechanics: the card fans out into one route per distinct checker.
  Each route carries its own exposure check (CAPS auto-verify, else a
  per-pick sign-off by the track verifier), its own SLA clock and
  chases, and its own escalation/fallback path. The card routes when
  every pick has cleared; it confirms when every sent line is decided.
- The verdict guard moves to the LINE: only that line's assigned
  checker can write its verdict (Invariant 3, per line). A checker
  sees only the lines sent to them.
- C3 refusal is per pick: a refused pick returns to the talent with
  the reason; cleared picks are never re-checked on re-send.

## DS-1 — The document screen (one read, one send)

Ratified via option "One read, one tap":

- After structuring, the talent gets ONE document-like screen: every
  line with its labels, its verbatim quote shown IN the conversation
  it came from, and a plain one-sentence rationale ("how we read it").
- Reading is the review; the single send is the act of approval.
  Every sent line still gets its per-line approval record at send
  (Invariant 5 partial approval intact). Undo works on any line until
  send. There is no per-line approve tap and no separate approve-card
  step.
- Per-line talk-it-out threads: the talent clarifies a line, argues
  with its rationale, or adds the missing piece in their own words;
  the words persist verbatim (Invariant 15) and the line re-checks
  through the existing contention/re-map loop. Never final over
  their objection.
- Evidence gate, shown plainly: a line that is thin or undated is
  "not backed yet — stays out until you back it", with exactly what
  is missing named on the line. Such lines physically cannot ride a
  send; they stay behind as costless drafts. (The pack flag string
  stays verbatim underneath — Invariant 1.)
- Checker visibility pre-send (ratified: "Name only"): the checker's
  name is pinned on the screen while the talent works; the checker
  sees NOTHING until send.
- Dispute controls (defend/contest) appear only after a checker says
  Adjust.

## DS-2 — Bolt-ins and signals on the document screen

Ratified via option "Full list, always": the pack's Part 3 bolt-ins
render as a full, always-visible list — "they can't claim what they
can't see" — claimed ones marked. Tapping one opens a small
contextual thread; the words persist verbatim; the structurer drafts
the line through the same FR-10 wall. Signals ("we also noticed")
are offered the same way, no pressure. A claimed signal stops being
"noted, not claimed".

## SC-1 — Spot-check replaces the calibration hold (FR-11 amended)

Ratified via option "Spot-check only": structured cards go straight
to the talent; nothing waits in a queue. JP reviews released cards
on his own time with the same correction tools.

THE FIX WINDOW (ratified "Yes — lock it"):
- Before the talent sends: JP's fix lands silently.
- After send, before the card reaches a checker: a fix PULLS THE
  LINE BACK — approval clears, the checker slot empties, the talent
  re-looks and re-sends. A checker never judges text the talent
  didn't approve.
- Once routed: log-only. The correction records as calibration input
  (Pack §E feed) and touches nothing on the card.
- The GATE-1 streak now counts cards that REACHED A CHECKER with
  zero corrections (5 across 3 talents unchanged; exit stays JP's,
  Invariant 14).

## SUM-1 — CAPS summary shape

Ratified ("hard to scan"): the activity summary renders as one short
opening line + 3–6 scannable bullet lines. Never a wall of text; all
A2 bans unchanged (no counts, no volume, no judgment, no links).
