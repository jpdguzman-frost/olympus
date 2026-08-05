# Olympus — Prompt Pack · Design Ops · v0.4 (lean)

Vocabulary extracted from "Design Ops: Competency Sheet — Karen Ong_v2"
(full read, Aug 5 2026). This pack contains VOCABULARY, SCHEMA, and
CALIBRATION LOG only. All behavior rules (capture flow, question
budget, upgrade standard, guardrails) live in Olympus__M0_Intent_v2.md.

GOVERNANCE: the sheet is being retired. This pack is now the CANONICAL
vocabulary. Changes are versioned and JP-approved only; the AI never
edits it. Existing confirmed records (Karen, Gwyn) remain valid against
the vocabulary version they were assessed under.

v0.4 supersedes v0.3: adds Ops systems design as a Part 2 RAMP gate
(the design/run split raised by Cathy — design is event-based judgment
proof, not a standing duty). v0.3 superseded v0.2: behavior removed.

CONSUMPTION: three readers. The AI reads Sections B (only words it may
output) and C (only shape it may produce) — never D or E. JP uses D
(review checklist) and E (correction log). The app ingests B + C as
the versioned vocab pack, immutable per card. Behavior lives in
Intent v2 alone.

---

## SECTION B — CONTROLLED VOCABULARY (verbatim, closed lists)

### B1. Execution states (column: Do you execute)
| State | Score |
|---|---|
| Not Yet | 0 |
| My work is being checked by someone else | 1 |
| I fully own the work — no one checks behind me | 2 |
| I own the work but delegates it to someone else | 3 |

### B2. Decision states (column: Do you make the decision)
| State | Score |
|---|---|
| I executed the decision given to me | 0 |
| I proposed and someone decided | 1 |
| I made the decision, but someone above me could overturn it | 2 |
| The decision is fully rest on me and no one else | 3 |

### B3. Scope tiers
| Scope | Tier |
|---|---|
| Own work | 1 |
| Own account | 2 |
| Others' work | 3 |
| Across tracks | 4 |

### B4. Verdict states
Pending · Adjust · Confirmed
("Confirmed" is the only accepting state.)

### B5. Part 1 competencies — The work you do
| Competency | What it means |
|---|---|
| Pipeline & Board Management | Keep boards matching reality: cards in the right lane, statuses current, finished and dead items cleared out so nothing on the board misleads. |
| Request intake & filing | Turn a client brief into clear, correctly-tagged cards (brand, deliverable, edit type) that anyone can act on without asking what they mean. |
| Revision tracking | Catch new client comments and revisions across docs, sheets, emails, and review pages, and turn them into cards before any get missed. |
| Status & blockers | Give the PM and Lead a status they can trust without re-checking — including what's stuck and why. |
| Workflow & file management | Move work to the right place as it progresses (lanes, dev files, client review) and keep files organized, clean, and lag-free. |
| Meeting facilitation | Run the DSU, checkpoints, and OPS CP so the team leaves clear on what's done, what's next, and who owns what. |
| Cross-functional coordination | Be the dependable point of contact for UI, asset, dev, and the PM: clarify requirements and keep everyone aligned on next steps. |

### B6. Part 2 gates — How well you hold the work
| Gate | Rule | What it means |
|---|---|---|
| Reliability | Required (floor gate) | The board stays accurate day to day on its own — the PM and Lead don't have to remind you or check behind you to know it's right. |
| Operational resiliency | Required | When the way of working changes (new deliverable, review process, team, or tool), your pipeline adapts and keeps showing true status — people still don't have to ask. |
| Operational awareness | Only when a disruption happens | When something disrupts the flow, you read it and make the right call (act, or hold steady) to keep status clear before anyone asks. |
| Ops systems design | Ramp — only when a structure was built from a blank slate | A project onboards with no existing structure: you read the brief and design the board and pipeline, the intake scheme, and the workflow so the work flows sensibly — without copying an existing setup. Adapting or improving a structure someone else designed is resiliency, not design. Absence is never a gap — empty is the normal J-level state. A try is not a hold: it lifts only if the project actually ran on the structure. |

Part 2 evidence fields: Date & Event · What you did · Who made the call.

### B7. Part 3 bolt-ins — Extra skills beside your level
Systems & tooling: Tool & automation development · Platform & account
administration.
Resource & planning: Resource management · Budget & tools forecasting.
People & process: Team onboarding · Process design & improvement.
Bolt-ins never change level. Only claim what you own, with proof.

### B8. Flags (closed list)
Floor met · Call not owned · did not make the call — doesn't lift level
· No disruption on record — not a gap · insufficient detail — draft
· signal noted, not claimed · not yet reached — not a gap
· designed, not held — doesn't lift level

### B9. Level labels (derivation output only — never AI-assigned)
J1 · J2 · J2 → Mid · Mid · Senior
Derivation is the sheet formula on confirmed rows. The AI never writes
a level label anywhere on a card.

---

## SECTION C — EVIDENCE CARD SCHEMA

One card per project. Fields, in order:

- Project / Account (name + date range, e.g. "JFC, April 2025 to present")
- Rows, one per claim:
  - Part (1 / 2 / 3)
  - Competency (from B5/B6/B7 only)
  - Execution state (from B1 only) — Part 1 & 3
  - Decision state (from B2 only)
  - Scope (from B3 only) — Part 2
  - My proof (account and dates; facts, not adjectives)
  - Traceback (verbatim quote of what the talent said that produced
    this mapping — every line must carry one; no quote, no claim)
  - Upgrade elements when claimed above anchor: Moment · Alternative · Trace
  - Non-Advocate (name, role; exposed to the work, not the Lead)
  - Verdict (from B4; starts Pending)
  - Flag (from B8, when applicable)
- Signals noted, not claimed (list, may be empty)
- Coverage sweep result (competencies with no claim this project)

The schema has no field for level, score, rank, or tier on the AI
side. Structurally impossible to output one.

---

## SECTION D — JP REVIEW CHECKLIST (per calibration card)

1. Every state label matches B1–B4 character-for-character.
2. No row above its anchor without all 3 upgrade elements.
3. Every ambiguity defaulted down and flagged — nothing guessed.
4. Upward signals in the input surfaced, and declines recorded.
5. Sweep ran; unmentioned competencies listed, not penalized.
6. No level, score, or promotion language anywhere.
7. Proof fields are facts with dates, not adjectives.
8. Diff against known record (Karen's confirmed sheet): zero inflation.

## SECTION E — CORRECTION LOG

| Run | Talent | Project | Error | Rule violated | Fix |
|---|---|---|---|---|---|
| | | | | | |

Every logged correction becomes a permanent regression case for the
app build (GATE-1 input).
