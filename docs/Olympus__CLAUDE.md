# CLAUDE.md — Olympus — Frost Competency Evidence Pipeline · Constitution
Adopt verbatim as the Spec Kit constitution. Do not soften,
generalize, or reword the 17 invariants. Anything generated that
conflicts with an invariant is an error.

## Context

This app is the interface to an already-built, already-validated
competency model (two live tracks: Design Ops, Art & Asset). The
model decides levels from evidence; this app captures evidence,
structures it with AI, and routes validation. The app changes the
interface, never the model. Guardrails ARE the product: a single
convenient deviation (a ranking view, a lead choosing validators,
an AI hinting a level) silently breaks the governance the model
exists to provide.

## The 17 invariants

1. **The model is upstream.** The app never edits the competency
   model, vocabulary, rungs, gates, or level logic. Vocabulary
   packs are versioned and immutable; every card records the pack
   version that structured it.

2. **Evidence only — no ratings.** No score, rating, ranking, or
   subjective assessment exists anywhere: not in UI, not in API
   responses, not in AI output, not in the database as claim
   content. Levels are read from confirmed evidence by ported
   model logic, never assigned.

3. **Verdict sovereignty.** The verdict field (Confirmed / Adjust)
   is writable only by the card's assigned non-advocate. No other
   role can write it — including admin, including JP. The server
   rejects all other writers.

4. **No substitution.** A lead may reject a talent's nominee with a
   stated reason. A lead may never insert, suggest, or substitute a
   nominee. Rejection always returns the pick to the talent.

5. **Talent approves before anything routes.** No claim reaches a
   lead or non-advocate without the talent's explicit per-claim
   approval. Partial approval routes only approved claims.

6. **Ambiguity defaults down.** When input supports two readings,
   the system claims the lower one and attaches a visible flag. The
   system may under-claim; it may never over-claim. Talent edits
   re-run vocabulary validation and cannot inflate past the rules.

7. **Silence is not a state.** Unmentioned competencies, and
   mentions without ownership language, map to NOT-CLAIMED — never
   to "Not Yet," never to "I don't do this," never to any state.
   NOT-CLAIMED is invisible to level reading and is never displayed
   as a gap or deficiency.

8. **Effort is not evidence.** Volume, hours, hustle, and project
   size are stripped from claims and never persisted as claim
   content. The count that matters is the model's own (people who
   worked on it after you), captured factually.

9. **Every claim carries its source quote.** Each claim stores the
   talent's verbatim words (original language) it was drawn from.
   The quote is the audit trail the non-advocate validates against.

10. **AI never outputs levels.** Structuring output structurally
    excludes levels, tiers, texture, ranks, readiness opinions, and
    promotion/raise language. A server-side validation layer
    rejects any label not in the track's controlled vocabulary,
    regardless of what the model returns.

11. **Pre-fill boundary.** Prior confirmed cards may display as
    context above an input. Nothing ever pre-fills an answer field.
    New evidence comes only from new input.

12. **No ranking UI.** No view sorts, ranks, or compares people.
    Aggregate views count cards and statuses only.

13. **Blank awareness is valid.** A gate with nothing on record
    reads NOT-TRIGGERED — a valid state, never a penalty, never a
    prompt to invent an event.

14. **Gates are human.** Calibration exit (5 consecutive clean
    cards across 3 talents, per track) and milestone acceptance are
    JP-owned gate tasks. The agent cannot check them off.

15. **Raw answers are never lost.** Capture persists before
    structuring runs. AI or network failure degrades safely and is
    retryable; no talent input is ever dropped.

16. **Server law.** All permissions in the role matrix are enforced
    server-side. The client is untrusted. Range protections,
    UI-hiding, and client checks are presentation, not security.

17. **Audit everything.** Every state change, edit, approval,
    rejection, and verdict is logged: who, what, when,
    before/after. The log is append-only.

## Precedence

BRD and Implementation Plan seed every phase. If a generated file
contradicts them, the documents win and the generated file is
corrected. If the BRD or Plan contradicts an invariant, the
invariant wins and the document is flagged to JP.
