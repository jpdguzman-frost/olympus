# Olympus — Frost Competency Evidence Pipeline — Implementation Plan v1.0
Seeds the Spec Kit plan step. The stack is decided; do not re-open
stack decisions. The prompt packs port verbatim; the plan must say
so. Preserve the phase sequence including both gates.

## 1. Stack (decided)

- Node.js backend, MongoDB, Redis (sessions + queues), Ractive.js +
  HTML/CSS frontend. Ares-parity conventions; hosted on Frost's
  server beside Ares. JP owns server and build cycle.
- Auth: Google Workspace sign-in, Frost domain restricted.
  (Integration depth with Ares auth: OD-1.)
- Anthropic API from the Node layer only; key in server env.
- Accepted risk on record: Ractive.js is unmaintained; chosen for
  Ares parity. Not a discussion item for the agent.

## 2. Pre-validated inputs (port verbatim — do not redesign)

- `docs/phase1-structuring-prompt-v0.2-ops.md` — Ops structuring
  pack: system prompt, controlled vocabulary, rules R1–R11 + R10a,
  card schema, flags.
- `docs/phase1-structuring-prompt-v0.3-artasset.md` — A&A pack:
  rules R1–R17 + R16a, five-state floor, seven-rung climb, ramp
  columns, Levels-table constraints.
- Level-derivation logic: ported from the two live sheets (Karen
  Ong Ops v2; Gwyn Cristo A&A). The sheets are the reference
  implementation; parity is acceptance (AC-2..AC-4).
These are calibrated artifacts. Reproduce; don't improve.

## 3. Data model (the schema is the schema)

users { googleId, name, roles[], track, leadId, active }
tracks { key: ops|artasset, vocabPackVersion, packText,
  questionSet[4], competencyOrDomainList[], fallbackReviewerId }
vocab_pack_versions { trackKey, version, packText, createdAt }
  — immutable, append-only.
cards { talentId, track, subject {name, kind: account|project},
  closeDate, filedDate, periodTag, status, rawAnswers[],
  sweepAnswers[], followUps[], claims[], productionRecord[],
  honestGap, nomination, packVersion, audit[] }
claims (embedded) { type, competencyOrDomain, labels{...exact
  vocab...}, sourceQuote, involvement, countAfterMe, flags[],
  talentApproved, verdict, verdictNote, verdictBy, verdictAt }
nomination { nominees[{userId, name, role}], systemChecks
  {advocateBlock, exposure}, leadDecision {action, reason, by, at},
  routedTo, repeatStreak }

Card status machine (server-enforced transitions only):
draft → structured → talent-approved → lead-nominee-review →
routed → confirmed | adjust → (adjust: back to talent → revised →
re-route) → archived.

## 4. Role/permission matrix (server law; test = AC-1)

| Write | Talent | Lead | Non-adv | Admin |
|---|---|---|---|---|
| Own card answers/edits | Y | N | N | N |
| Card shell (name+date, for report) | — | Y | N | N |
| Claim approval (own card) | Y | N | N | N |
| Nominee tag (own card) | Y | N | N | N |
| Nominee approve/reject+reason | N | Y | N | N |
| Nominee substitution | N | N | N | N |
| Verdict | N | N | Y (assigned only) | N |
| Part 4 reading | N | Y | N | N |
| Vocab pack version publish | N | N | N | Y |
| Calibration review actions | N | N | N | Y |

Reads: talent sees own cards + own ladder; lead sees reports'
confirmed cards; non-advocate sees only cards routed to them;
admin reads all. Verdict field rejects every writer except the
assigned non-advocate — including admin (Invariant 3).

## 5. Question sets (fixed; render verbatim)

Ops, per account: (1) What account and work is this, and since
when? (2) What do you run yourself day to day — and what does
someone still check behind you? (3) What calls did you make alone
here — and who made the other calls? (4) Did anything break or
change along the way? What did you do?

A&A, per project: (1) What project was this, and what did you make
on it? (2) When your work went out — did anyone open the file
after you and change it, or did it ship as you made it? Do you fix
other people's files? (3) The direction — did one already exist?
If you made or changed one: who shaped it, who decided it, who
carried it — and how many people touched it after you? (4) Do you
review others' work here? What happens to what you pass?

## 6. Services

- capture: question flow (guided + single-pass), drafts, sweep
  orchestration, shells, pre-fill context rendering.
- structurer: Anthropic call with pack + answers; parser; vocab
  validation layer (rejects off-vocab labels; FR-10); flag
  attachment; follow-up budget enforcement.
- confirmflow: per-claim approval, edit re-validation, nomination,
  system checks, lead queue, routing, verdict handling, repeat
  streak.
- reader: level derivation per track (sheet-parity), ladder view,
  quarterly assembly.
- exporter: nightly one-way Sheets export (FR-22).
- notifier: nudges (30d), queue notifications.
- audit: append-only log middleware on all mutations.

## 7. Phase sequence (implement one phase, stop at the boundary)

P0 — M0 calibration (no code; runs in Claude Projects in parallel
   with P1–P2). Exit = GATE-1.
P1 — Auth, users/roles, data model, audit middleware. (AC-1
   partial, AC-7)
P2 — Capture: questions, both modes, drafts, sweep, shells,
   pre-fill boundary. (FR-1..FR-6, FR-8 capture side, AC-8 raw
   persistence)
P3 — Structurer + validation layer + calibration queue.
   (FR-7..FR-11, AC-5, AC-6)
P4 — Confirm + nominate/verify + lead approval + routing +
   verdicts + repeat flag + thin pool. (FR-12..FR-17, AC-1 full)
P5 — Reader: derivation parity, ladder home, quarterly view.
   (FR-18..FR-20, AC-2..AC-4) → GATE-2.
P6 — Exporter + nudges + polish. (FR-21, FR-22, AC-10)
P7 — Pilot: Karen, Jacob, Gwyn live on the app; calibration mode
   ON per Invariant 14 until AC-9.

Gates (JP-owned tasks; the agent cannot check them off):
- GATE-1 (end P0, blocks P7 entry into live use): AC-9 calibration
  exit — 5 consecutive zero-correction cards across 3 talents per
  track.
- GATE-2 (end P5, blocks P6/P7): derivation parity — Karen's and
  Gwyn's records reproduce exactly (AC-2..AC-4), confirmed by JP
  against the live sheets.

## 8. Estimates (sanity bound, not commitments)

P1 3d · P2 5d · P3 5d · P4 6d · P5 5d · P6 3d · P7 ongoing pilot.
~27 dev-days. If generated tasks sum wildly past this, they are
over-decomposed or padded.

## 9. Change management

Requirement changes enter the BRD first, then plan/tasks re-run for
the affected slice, then implement. Open decisions: when answered,
record in the spec clarifications, then unblock. OD-1 blocks any
auth-sharing tasks beyond standalone Google sign-in; standalone
sign-in is NOT blocked.

## 10. Blocked markers for the tasks step

- BLOCKED-OD1: any task integrating Ares auth/session/user store.
- BLOCKED-OD2: fallback-reviewer routing config (route logic
  builds; the two names are config).
- BLOCKED-GATE1: enabling live talent use in P7.
- BLOCKED-GATE2: P6 start.
