# JP Review Bundle — everything waiting on your judgment

Collected 2026-08-04. Nothing below blocks the build; everything below
blocks *go-live*. Work through it in order — items 1–3 are the substance,
4–6 are config/keys.

## 1. Calibration reps (FR-11 / GATE-1)

**Karen's GCash card is held in your calibration queue, untouched** —
http://localhost:4600/admin.html (dev-login as yourself). It is your first
real calibration rep. Watch for:

- One quote fed two claims (Operational resiliency + Process design &
  improvement bolt-in). Your verdict becomes the rule — if one event may
  never feed two claims, I add it to the pack and re-version.
- "I decided the file naming system alone" was read at "I made the
  decision, but someone above me could overturn it" + COULD-BE-HIGHER.
  Confirm that defaulting-down is the read you want when the talent
  doesn't say whether anyone could overturn.

(Jacob's card was my end-to-end verification artifact — released,
confirmed, and routed by dev users. Its audit trail says so. Karen's rep
is clean for you.)

## 2. Pack drafts — the [NEEDS JP] markers

`docs/phase1-structuring-prompt-v0.2-ops.md` and `v0.3-artasset.md`:

- **Ops R10a** — unrecognized extra skill: flag-and-hold vs follow-up.
- **A&A R8** — refined-before-out with a direction claim: keep the honest
  direction words + FLOOR-BLOCKS-CLIMB flag (my draft) vs drop the
  direction label entirely (the sheet voids it).
- **A&A R14** — from-scratch claimed inside GCash Design Support:
  dedicated flag vs FLOOR-BLOCKS-CLIMB (my draft reuses it).
- **Cascade contradiction** — the sheet says "Cascade reads 1" but your
  own Adjust feedback set Gwyn's Cascade rows to rung 3 ("set the
  direction from an existing system"). The pack currently allows any rung
  on Cascade and the derivation follows the Levels table. Confirm intent.
- Rule NUMBERING in both packs follows the Plan's reference structure
  (R1–R11+R10a / R1–R17+R16a) but the content-to-number mapping is my
  articulation — confirm it matches how you'd cite them.

## 3. Derivation parity (GATE-2, blocks P6)

`test/readerParity.test.js` replays both reference records:

- Karen's 26-row record → **J2 → Mid**, floor Met, resiliency never lifts.
- Gwyn's record → **Mid · Late**; refined-before-out stays Below floor;
  rung 4+ without 2a caps at Mid; GCash never exceeds Mid.

Two extrapolations are marked `parityUnconfirmed` in
`src/services/readerService.js` because the sheets never exercised them:
(a) decision="made it, overturnable" with execution below "delegates" →
J2; (b) decision="fully rest on me" → Mid. Confirm or correct at GATE-2,
against the live sheets.

Also: the Ops aggregate read is "highest confirmed pair wins". Karen's
sheet displays "J2 · Mid-early" where the app renders the pair tier
"J2 → Mid" — same read, different display string. Tell me which string is
canonical for FR-19.

## 4. OD-2 — fallback reviewers

Thin pool is built and refuses with an OD-2 message until you set names
(suggested in the BRD: Miles/Ops, Gwyn/A&A). One command each:
set `fallbackReviewerId` via admin PATCH or tell me the names and I wire
them as config.

## 5. Google OAuth (deferred earlier)

When ready: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in server env.
Dev-login disables itself the moment they exist.

## 6. Real users + real emails

Dev users carry fake `@dev.olympus.invalid` emails. Before pilot: create
Karen/Jacob/Gwyn/Miles with real Frost emails via the admin page, assign
leads, deactivate the dev cast.

## Also parked (per the Plan, not your judgment)

- **P6 (exporter + nudges)** is BLOCKED-GATE2 — starts when you confirm
  item 3.
- **OD-1** (Ares auth surface) stays open; standalone sign-in unaffected.
- **OD-3/OD-4** recorded, no action.
