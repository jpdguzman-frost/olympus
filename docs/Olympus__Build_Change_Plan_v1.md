# Olympus — Build-Change Plan v1 (Amendment 1 + Rulings C1–C9)

Date: Aug 5, 2026 · Status: APPROVED Aug 5; ALL SIX PACKAGES BUILT Aug 5. Governed by: Intake Amendment 1 +
Olympus__Rulings_2026-08-05.md > Aug 3 documents. Invariants in
force throughout; verdict sovereignty absolute.

Sequence: six work packages, smallest-risk first. Each package ships
with its tests green before the next starts.

---

## B1 — Pack v0.4 + behavior split + role settings — **DONE Aug 5**

Config and plumbing; no governance-flow behavior changes.

1. **Vocab sidecar v0.4** (`docs/vocab-v0.4-ops.json`) from Pack
   §B1–§B8 + schema §C: execution/decision enums with scores, scope
   tiers, verdict states, Part 1/2/3 lists incl. the new **Ops
   systems design** RAMP gate, §B8 claim-level flags. Documents the
   C6 two-layer flag split: §B8 = claim-level (on lines);
   BR-1/BR-4/FR-15 set (STALE, THIN-POOL, PROPOSED-BOLT-IN, …) =
   card/system-level context. Both layers enumerated in the sidecar.
2. **Publish v0.4** to the ops track (append-only VocabPackVersion;
   v0.2-draft1 remains immutably on record); repoint track. Existing
   confirmed cards stay valid under their assessed pack version.
3. **Delete superseded files**: `phase1-structuring-prompt-v0.2-ops.md`
   + `vocab-v0.2-ops.json` (per A7; the Ops [NEEDS JP] markers in
   them die with the pack). `v0.3-artasset` files stay — the A&A
   sheet remains that track's reference until A&A Pack v0.4 lands.
4. **Behavior-spec store**: new append-only `BehaviorSpecVersion`
   collection (same pattern as vocab packs). Structurer system
   prompt = current behavior spec text + vocab pack §B/§C — Intent
   v2 text loaded as `v2-calibrating` DATA, never hard-coded;
   admin-publishable so JP can revise during calibration; verbatim
   port re-published at GATE-1.
5. **OD-2 role setting**: per-track `fallbackReviewerId` becomes
   admin-assignable in a system-settings admin UI (DB-backed, no
   deploy to change). Exclusion rule enforced server-side at
   assignment-to-card time: never the talent, the nominee, or a
   deadlock party. Read at escalation time, never snapshotted.
   Unset/excluded at escalation → escalation halts and surfaces on
   the JP dashboard for manual action [likely — smallest safe
   default; say the word if you want different].
6. Same-pattern **exposure-verifier role setting** per track
   (Miles/Don assigned in admin UI at pilot, not in code) — proposed
   for consistency with the OD-2 ruling [likely].

Touches: `docs/`, `VocabPackVersion`, new model, `structurerService`
prompt assembly, `routes/admin.js`, admin UI. Est. 2d.

## B2 — Verdict mechanics (A5; additive, server-first) — **DONE Aug 5**

1. **Attestation**: Confirmed requires a one-line "what I checked"
   statement; schema field + `applyVerdict` enforcement + reviewer
   UI + audit. Adjust keeps its required note.
2. **Explicit `Pending`** verdict state (Pack §B4) replacing null —
   cosmetic alignment.
3. **C1 deadlock machine** — new states `deadlocked`, `ruled`,
   `reassigned`:
   - Talent gains a per-claim **defend** action (stand by the claim
     unchanged, statement required) as the alternative to fix;
     re-route carries the defense. Concession after defense requires
     a stated reason, original evidence side-by-side (Intent v2).
   - Reviewer re-issues Adjust on a defended claim → card →
     `deadlocked`; both positions logged append-only.
   - JP writes a **ruling** (new admin-only write; the verdict field
     still rejects JP — Invariant 3 untouched) → `ruled`; same
     reviewer re-reviews with the ruling in view.
   - Reviewer agrees → writes the verdict themselves (normal
     confirmed/adjust legs). Reviewer refuses (explicit action,
     logged as final position) → `reassigned` → auto-reassign to the
     track's fallback reviewer (OD-2 setting, exclusion rule) →
     fallback writes the verdict.
   - Permission matrix additions: ruling = admin only; refuse =
     assigned reviewer only; reassignment = server only.
4. **SLA worker**: 10 working days (Asia/Manila, Mon–Fri; no holiday
   calendar in v1 [likely]), two automatic chases, then
   auto-escalation to the fallback reviewer. Non-response is never a
   verdict — escalation reassigns, never decides.
5. **JP pending-verdict dashboard**: every card pending verdict —
   assigned nominee, aging in days, chase count, repeat-reviewer
   count (C5), manual nudge. Counts and statuses only; no ranking
   (Invariant 12).
6. **"Confirmed — packaging deferred"** state (C9 hook): settable
   after confirmed; level always recorded, never erased.

Touches: `Card`, `constants` status machine, `cardService.applyVerdict`,
new `slaWorker`, `routes/admin.js`, admin UI, permissionMatrix +
statusMachine tests. Est. 3d.

## B3 — Nomination rework (A1/C2/C3/C4/C5) — **DONE Aug 5**

Retires the now-unlawful lead-approval leg; medium risk (status
machine + permission surgery, test rewrites).

1. **Single nominee** (C2). Nominee picker becomes pick-one.
2. **Retire `lead-nominee-review`**; new transitions:
   talent-approved → routed (exposure auto-verified) OR
   talent-approved → `exposure-signoff` → routed / back to
   talent-approved on refusal **with required reason** (C3 —
   Invariant 4's rejection leg, re-homed to the exposure verifier).
3. **Exposure check v1 (pre-CAPS)**: no CAPS client yet → every
   nomination routes to the track's exposure verifier for the
   one-line sign-off. CAPS auto-verify (3+ separate review weeks)
   activates in B5 and bypasses sign-off when met.
4. **C4**: shell routes/UI retired; lead Part 4 write retired; Part
   4's core question rendered as static guidance text on the verdict
   screen.
5. **C5**: rotation prompt at nomination time, talent-facing,
   advisory, never blocking (streak vs. the talent's prior routed
   cards).
6. **Lead scope reduction**: lead reads = exposure verifiers only
   (Miles/Don), read-only, own people. Lead dashboard shrinks to a
   read-only confirmed-records view + sign-off queue.

Touches: `confirmService` (nomineeCandidates, submitNomination,
decideNomination → signoff, repeatStreak), `constants`,
`routes/team.js`, `routes/cards.js`, lead + talent frontends,
permissionMatrix/confirmFlow/statusMachine/visibility tests. Est. 3d.

## B4 — Card mechanics (A4) — **DONE Aug 5**

1. **Date anchoring**: per-claim date/period + account anchor;
   unanchored claims cannot be approved for routing — they stay
   draft with talent-facing "needs a date" (never blame wording).
   CAPS date prompts arrive with B5.
2. **Contention loop**: talent contests a line against its traceback
   → structurer re-maps that line (single-line re-map mode) or
   explains; loop until accepted or line stays draft. A mapping is
   never final over the talent's objection. Re-maps re-run FR-10
   validation; cannot inflate.
3. **Signals noted, not claimed**: card-level list written at
   structuring when an upward invitation is declined; visible to the
   reviewer; plus the C9 hook — an admin resurface list (read-only
   view of unclaimed signals for manual Endorsement Review).
4. **Draft lifecycle**: archive (never delete) at 90 days, one
   pre-expiry nudge, revive action; `draft → archived` leg.
5. **Traceback naming**: sourceQuote already schema-mandatory
   [sure]; UI renders "Because you said: …" per line.
6. **Language pass**: extend FLAG_NUDGES for the new §B8 flags;
   internal flag vocabulary never shown raw to talent.

Touches: `Card`, `structurerService` (re-map mode),
`cardService`/`confirmService`, new archive worker, talent frontend,
capture/structurer/confirmFlow tests. Est. 4d.

## B5 — CAPS integration (A2; CSV side build) — **DONE Aug 5**

Source of record for now: JP's cleaned CSV extract from the
`../caps-analysis` project (H1 2026 window, Jan 5 – Jul 10, ~26k
task×contributor rows; 2024–2025 backfill later "once the model
works"). The upstream Redis datastore CAPS pulls from is a future
adapter behind the same `capsService` interface — nothing else in the
app knows or cares which source fed it. Unblocked; no external access
needed.

1. **Whitelist-only import** (`npm run import-caps -- <csvFile>`),
   versioned batches. Only these fields ever enter the app, per A2:
   task name, category, project name, contributor name, the
   name-valued reviewer columns (Peer/Design/Content/Dev/Code/Ops
   Review, Content Checks, QA Validation, Design QA), date, ISO
   week. **Leadership weeks: ON HOLD (JP, Aug 5 — "finicky"); the
   credit-detail CSV is not imported.** In its place, **project
   tenure**: first → last task date per (contributor, project),
   derived from the already-whitelisted dates, nothing extra
   ingested. EVERYTHING else in the files is dropped at the
   boundary — Task/Contribution Weight, Final Score, Difficulty,
   the numeric review-score columns, Full/Major/Partial credit,
   Accepted/Discarded, roster rung/mode/total. Whitelist ingestion,
   not blocklist: unnamed columns never persist.
   Consequence while the hold stands: Intent v2's upward-signal
   duty runs on review authority (reviewer columns) only —
   leadership weeks stop being a surfaced signal until JP lifts
   the hold.
2. **Identity join**: CAPS speaks names, not emails. Users get an
   admin-editable `capsName`; the import applies the canonical alias
   rules (Roni→August, Yelle→Erielle). Unmapped names simply don't
   join — no guessing.
3. **Hard-wall test class** (Invariant-18-to-be): import a fixture
   CSV carrying banned columns → assert stored documents hold only
   whitelisted keys, and no API payload, prompt, or view model ever
   contains a weight, score, difficulty, band, or total. Review
   count never treated as review authority.
4. **Exposure auto-verify** switches on: nominee's name appears in a
   reviewer column on the talent's rows for that project across 3+
   distinct weeks (threshold config, tunable post-pilot) → skips
   sign-off; below/no record → B3's sign-off path.
5. **CAPS date prompts** in capture from min/max task dates per
   (contributor, project); catch-up door lists the talent's CAPS
   projects with no card.
6. Stale or absent extract → everything degrades to the fallback;
   CAPS is an accelerator, never a gate (extract freshness is
   whatever JP last imported — shown on the admin page).

Touches: new `capsService` + import script + mirror collection,
User.capsName + admin UI, `confirmService` exposure check, capture,
new test class. Est. 3d.

## B6 — Two-door capture (A3) — **DONE Aug 5**

1. **Door 1 "File a project"** (default, at close) and **Door 2
   "Catch up"** (date-range entry listing CAPS projects with no
   card; each pick opens the same per-project flow; range-pull is
   navigation, never a capture mode).
2. **Propose-don't-interrogate**: from CAPS task data, draft one
   claim per touched matrix row at the lowest plausible reading;
   1 anchor question per touched row, max 2 clarifiers per row;
   budget spent → "insufficient detail — draft." Design/run probe on
   board/intake/workflow claims (inherited → Part 1; adapted →
   resiliency; blank slate → Ops systems design, dated event).
3. **Sweep**: still one compact message; every "yes" gets one detail
   invite before drafting; ramp gate never swept or flagged absent.
4. **No-CAPS fallback** = the current four-question capture, both
   modes kept (C7): guided chat default, single-pass accepted.
5. **Per-project Ops cards**: `subject.kind` account → project;
   dev-data migration (Karen's held calibration card preserved
   untouched; confirmed cards remain valid under their pack
   version).

Touches: capture frontend + `cardService` + `structurerService` +
worker, seed/migration script, capture tests. Est. 4d.

---

## Proposed C8 mapping — M-milestones → P-phases (NOT ratified)

| M | P | Content | Gate |
|---|---|---|---|
| M0 | P0 | Calibration, no code | exits at GATE-1 |
| M1 | P1 + P2 | Auth/roles/model/audit + capture | |
| M2 | P3 | Structurer + validation + calibration queue | |
| M3 | P4 | Confirm / nominate / verdict (as amended) | |
| M4 | P5 | Reader: level derivation display | **OD-5 must close before M4** |
| M5 | P6 | Exporter (archive-mode per A8) + nudges | blocked by GATE-2 |
| M6 | P7 | Pilot | blocked by GATE-1 |

Rationale: OD-5's "before M4" lands exactly on the phase that builds
derivation display — internally consistent with the amendment
[likely]. Note P5 exists in the current build against sheet parity;
under this map its derivation is provisional until OD-5 closes.

## OD-5 recommendation (your decision)

Recommended home: a **derivation appendix in the versioned Ops pack**
— §B1/§B2 already carry the score columns; adding the pair→level
table as a §F makes derivation data JP-versioned exactly like
vocabulary, immutable per card, no deploy to change. Code reads the
tables; parity fixtures stay as regression. Alternative: derivation
stays in code with the pack holding only scores. Recommendation:
the appendix [likely].

## Dependencies and asks

1. Plan approval (covers the B1 file deletions).
2. C8 map ratification.
3. CAPS/Raintool API access — blocks B5, and B6's full value.
4. OD-5 home — decide before B-work reaches the reader (not blocking
   B1–B4).

## Standing constraints

**Copy rule (JP, Aug 5): every user-facing word is J1-simple — short
sentences, everyday words, no jargon, "so simple it's hard to miss."
Exception: pack vocabulary is verbatim, never reworded (Invariant 1).**

Verdict sovereignty absolute (JP's ruling is guidance, never a
verdict). AI never levels. Default-down. No ranking views. Karen's
held calibration card untouched throughout. Intent v2 loaded as
versioned data, never hard-coded. All Aug 3 tests that encode
superseded flows (lead approval) are rewritten, not deleted —
coverage may not drop. Estimates: B1 2d · B2 3d · B3 3d · B4 4d ·
B5 3d · B6 4d ≈ 19 dev-days [likely].
