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
