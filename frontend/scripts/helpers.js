/* Display helpers shared across pages. */

/* JP's rule: words so simple a J1 gets them without thinking. */
const STATUS_LABELS = {
  draft: 'Draft',
  structured: 'Ready to check',
  'talent-approved': 'Approved by you',
  'exposure-signoff': 'Checking your pick',
  routed: 'With your reviewer',
  confirmed: 'Confirmed',
  adjust: 'Needs a fix',
  revised: 'Updated',
  deadlocked: 'Stuck — with JP',
  ruled: 'JP replied — with reviewer',
  reassigned: 'With a backup reviewer',
  archived: 'Archived',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function stampClass(status) {
  if (status === 'confirmed') return 'stamp-confirmed';
  if (status === 'adjust' || status === 'deadlocked') return 'stamp-adjust';
  if (status === 'draft') return 'stamp-draft';
  return 'stamp-inflight';
}

/** Pack §B4: Pending · Adjust · Confirmed — null renders as Pending. */
function verdictLabel(verdict) {
  return verdict || 'Pending';
}

function answeredCount(card) {
  if (!card || !card.rawAnswers) return 0;
  const real = card.rawAnswers.filter((a) => (a.answer || '').trim().length > 0);
  if (real.some((a) => a.questionIndex === null || a.questionIndex === undefined)) return 4; // single-pass dump covers all four
  return Math.min(real.length, 4);
}

/* FR-12: flags render as plain-language nudges, never as jargon.
   The KEYS are pack vocabulary — verbatim, never reworded (Invariant 1).
   The VALUES are ours — J1-simple, never blaming (A4). */
const FLAG_NUDGES = {
  'NEEDS-OWNER': 'Who made this call? Write their name.',
  'COULD-BE-HIGHER': 'This might be bigger than it says. If so, say it plainly and fix the label.',
  'NEEDS-2A': 'You made a new direction? Tell us who shaped it, who decided, who carried it, and how many people came after you.',
  'NEEDS-INVOLVEMENT': 'Tell us what YOU did here, in your own words.',
  'FLOOR-BLOCKS-CLIMB': 'Someone still fixes this work before it goes out. So a direction claim can’t count on this project.',
  STALE: 'Filed long after the work ended. Just context for your reviewer. Not a penalty.',
  'PROPOSED-BOLT-IN': 'This extra skill is not on the list yet. It is saved, and JP will look at it.',
  'THIN-POOL': 'No reviewer fit this card, so it took the backup path.',
  'NOT-TRIGGERED': 'Nothing happened here yet. That is fine. Not a gap.',
  /* Pack v0.4 §B8 claim-level flags. */
  'Floor met': 'You hold this on your own. No one checks behind you.',
  'Call not owned': 'The call was not yours here. Written down honestly. That is fine.',
  "did not make the call — doesn't lift level": 'You did the work. Someone else made the call. It still counts — it just does not raise your level.',
  'No disruption on record — not a gap': 'Nothing broke on your watch. That is fine. Not a gap.',
  'insufficient detail — draft': 'Saved as draft. Add the missing detail any time. Nothing is lost.',
  'signal noted, not claimed': 'We saw something you chose not to claim. It is noted. No pressure. Your reviewer may still ask.',
  'not yet reached — not a gap': 'Not part of your work yet. That is fine. Not a gap.',
  "designed, not held — doesn't lift level": 'You designed it, but the project did not run on it. Saved — it just does not raise your level.',
};

function flagNudge(flag) {
  return FLAG_NUDGES[flag] || flag;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function toDateInput(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function debounce(fn, ms) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function templateById(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing template: ${id}`);
  return el.innerHTML;
}
