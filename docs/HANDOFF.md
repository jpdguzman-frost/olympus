# Olympus — Session Handoff (2026-08-05)

Read this + `CLAUDE.md` + `docs/JP-REVIEW.md` to resume with full context.
The three seed documents (`Olympus__CLAUDE.md` constitution, `Olympus__BRD.md`,
`Olympus__Implementation_Plan.md`) remain law; the 17 invariants are non-negotiable.

## Where the build stands

| Phase | State |
|---|---|
| P1 auth/roles/model/audit | DONE, tested |
| P2 capture (questions, modes, drafts, sweep, shells) | DONE, tested |
| P3 structurer + FR-10 validation + calibration queue | DONE, tested, ran live on real API |
| P4 confirm/nominate/route/verdict/adjust cycle | DONE, tested, verified in browser |
| P5 reader (derivation, ladder, quarterly) | DONE, parity fixtures pass |
| P6 exporter + nudges | NOT BUILT — blocked by GATE-2 (JP parity confirmation) |
| P7 pilot | Blocked by GATE-1 (calibration exit, AC-9) |

104/104 tests. All pushed to `main` (github.com/jpdguzman-frost/olympus, SSH remote).

## Current focus (what JP asked for last)

JP is walking the app **as a talent** to shape the experience-refinement arc.
JP dumps raw friction notes; I turn them into the refinement queue.
Known refinement items, in arc order (none started):

1. **FR-8 sweep checklist** — sweep still asks a generic "anything else?";
   should enumerate the track's unmentioned competencies now that packs are
   loaded (per-item "not me"). The one spec-adjacent gap. Judgment-free — buildable now.
2. **Liveness** — after submit/release/reject/adjust the talent must refresh;
   add light auto-refresh (full notifications are P6). Judgment-free — buildable now.
3. **Guided mode rhythm** — FR-3 says "guided chat"; today it's static blocks.
   Biggest experience lift; wait for JP's tone notes before building.
4. Mode-switch (guided↔single-pass) keeps separate text fields; nominee picker
   is ungrouped; mobile widths unverified (BRD requires responsive web).

## Waiting on JP (docs/JP-REVIEW.md — do not do these for him)

1. Calibration rep: **Karen's GCash card held in the admin queue — leave it
   untouched.** Two structurer rulings: may one quote feed two claims?
   Is default-down + COULD-BE-HIGHER on "I decided alone" right?
2. Five `[NEEDS JP]` markers in the two pack drafts — incl. the **Cascade
   contradiction** (sheet says "Cascade reads 1"; JP's own Adjust feedback set
   Gwyn's Cascade rows to rung 3).
3. GATE-2 parity: app reads Karen **J2 → Mid**, Gwyn **Mid · Late**; two
   `parityUnconfirmed` extrapolations in `readerService.js`. Also: sheet
   displays "J2 · Mid-early" vs app's "J2 → Mid" — which string is canonical?
4. OD-2 fallback names; 5. Google OAuth creds (deferred); 6. real user emails.

## How to run / verify

- `node server.js` (bg task may already be running) — http://localhost:4600,
  port 4600. `.env` has MONGODB_URI (localhost/olympus), REDIS_URL, PORT,
  ANTHROPIC_API_KEY (JP set it; never print it).
- Local mongod + redis are brew services, already running.
- Dev login (no Google creds set): JP admin = jpdguzman@frostdesigngroup.com;
  dev cast = dev-karen/dev-jacob/dev-gwyn/dev-reviewer/dev-lead
  @dev.olympus.invalid. Jacob's card was my E2E verification artifact
  (confirmed, feeds his J1 ladder read); Karen's is JP's calibration rep.
- `npm run build` = frontend (Ractive parse-checked, frontend/ → public/);
  `npx vitest run` = suite; `npm run seed`; `npm run load-packs -- <track>
  <version> <packFile> <vocabFile>`.
- Browser verify via chrome-devtools MCP (kill orphaned
  `chrome-devtools-mcp/chrome-profile` Chrome if connection blocked).
  Screenshots 01–13 in `screenshots/` (gitignored).

## Architecture crib (Ares-parity, ESM, Express 5)

- `server.js` bootstrap → `src/app.js` composition. Mongoose models in
  `src/models/` (Card embeds claims/nomination/audit; VocabPackVersion +
  AuditLog are append-only via pre-hooks). Status machine in
  `src/config/constants.js` (draft→structured→talent-approved→
  lead-nominee-review→routed→confirmed|adjust→revised→routed; reject leg
  lead-nominee-review→talent-approved).
- Services: `cardService` (CRUD, visibility matrix, presentCard hides claims
  during calibrationHold + computes BR-4 stale), `confirmService` (P4:
  decideClaim/approveCard/submitNomination+system checks/decideNomination/
  repeatStreak/reroute), `structurerService` (claude-opus-5, pack verbatim as
  system prompt, structured-output JSON schema with NO level field, FR-10
  validateStructuredOutput fails closed, quotes must be verbatim substrings),
  `calibrationService`, `readerService` (Ops pair scoring + A&A Levels table
  verbatim), `auditService`, `statusMachine`, `seedService`.
- `src/workers/structurerWorker.js` polls submitted drafts every 15s; failure
  leaves draft+raw intact with backoff (AC-8); no pack → 'awaiting-pack'.
- Verdict sovereignty: `applyVerdict` in cardService — assignment-based
  (nomination.routedTo), admin rejected like everyone; Adjust clears
  talentApproved (BR-7).
- Frontend: `frontend/{styles,templates,scripts}` + shells → `build.js` →
  `public/`. Ractive 1.4.2 (vendored). Pages: index (home/capture/detail SPA,
  hash-routed), lead.html, admin.html, login.html. Design: "evidence ledger" —
  IBM Plex, paper #f6f7f4, carbon blue #3d48b8, status stamps, verbatim quotes
  in serif italic. No ranking UI anywhere (Invariant 12).
- Packs live: v0.2-draft1 (ops) / v0.3-draft1 (artasset) published to dev DB
  from `docs/phase1-structuring-prompt-*.md` + `docs/vocab-*.json` sidecars
  (transcribed 1:1 from JP's two Google Sheets — letter-perfect vocab).
  Zero-states ("Not Yet", "I don't do this") are deliberately unclaimable.

## Working agreement (verbatim-critical)

Reply format in `CLAUDE.md`: HEADLINE / WHAT I NEED FROM YOU / STATUS (≤5
bullets) / DETAIL below `---`. No process narration; [sure]/[likely]/[guess]
tags; one screen; tables for 3+ items; keep decisions simple.
JP wants judgment-free work done autonomously and JP-judgment items batched
into `docs/JP-REVIEW.md`. Commit style: phase-scoped conventional messages +
Claude co-author trailer, push to main directly.

## Immediate next actions on resume

1. If JP delivered walkthrough notes → convert to refinement queue, build.
2. Else: build refinement items 1–2 (sweep checklist, auto-refresh) — both
   judgment-free and spec-adjacent.
3. After JP confirms GATE-2 → build P6 (nightly one-way Sheets export FR-22
   in the existing instrument format, nudges FR-21: 30d gentle prompt +
   lead visibility list, never a penalty).
