# JP Review Bundle — everything waiting on your judgment

Collected 2026-08-04. Nothing below blocks the build; everything below
blocks *go-live*. Work through it in order — items 1–3 are the substance,
4–6 are config/keys.

## 1. Calibration reps (FR-11 / GATE-1)

**Correction (Aug 5): Karen's GCash card is NOT held.** The audit trail
shows it was calibration-released on Aug 3 at 21:28 by the JP-admin
identity — 17 minutes before Jacob's card. That was my E2E session
using your dev-login, not you. My earlier claim that her card was left
untouched was wrong; the release is on the record and was not reversed.

Practical impact is small: that card was structured under retired pack
v0.2, so a rep against it would have been moot after Amendment 1 §A6
anyway. **Your first real calibration rep now comes from any newly
submitted Ops card** — calibration mode is ON and structuring runs
v0.4 + behavior spec v2-calibrating, so the next card holds for you at
http://localhost:4600/admin.html (Karen has three open drafts).

Two structurer rulings still stand, now to be judged on a v0.4 card:

- May one quote feed two claims? (Seen on the released card:
  Operational resiliency + Process design & improvement bolt-in.)
- Is default-down + a could-be-higher signal the read you want when the
  talent says "I decided alone" without saying whether anyone could
  overturn it?

## 2. Pack drafts — the [NEEDS JP] markers

**Ops markers are RESOLVED by Amendment 1 §A6/§A7**: pack v0.2 is
retired and deleted; Pack_Ops_v0.4.md is canonical. (Ops R10a and the
Ops rule-numbering questions died with it.)

**A&A markers remain open** (`docs/phase1-structuring-prompt-v0.3-artasset.md`
stays the sheet transcription until A&A Pack v0.4 arrives):

- **A&A R8** — refined-before-out with a direction claim: keep the honest
  direction words + FLOOR-BLOCKS-CLIMB flag (my draft) vs drop the
  direction label entirely (the sheet voids it).
- **A&A R14** — from-scratch claimed inside GCash Design Support:
  dedicated flag vs FLOOR-BLOCKS-CLIMB (my draft reuses it).
- **Cascade contradiction** — the sheet says "Cascade reads 1" but your
  own Adjust feedback set Gwyn's Cascade rows to rung 3 ("set the
  direction from an existing system"). The pack currently allows any rung
  on Cascade and the derivation follows the Levels table. Confirm intent.
- A&A rule NUMBERING (R1–R17+R16a) is my articulation — confirm it
  matches how you'd cite them.

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

## 4. OD-2 — fallback reviewers (now an admin setting, per your ruling)

Set them yourself on the admin page (Tracks → "Fallback reviewer" /
"Exposure verifier" selects, per track) — no deploy, changeable anytime,
read at use time. Initial assignments at pilot: your ruling named Miles
(Ops) and Don (A&A-side) for exposure sign-off; fallback-reviewer names
are still yours to pick. Create the users first if they don't exist.

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
