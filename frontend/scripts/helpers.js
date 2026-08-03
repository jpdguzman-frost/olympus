/* Display helpers shared across pages. */

const STATUS_LABELS = {
  draft: 'Draft',
  structured: 'Structured',
  'talent-approved': 'Approved by you',
  'lead-nominee-review': 'With your lead',
  routed: 'With your reviewer',
  confirmed: 'Confirmed',
  adjust: 'Needs a fix',
  revised: 'Revised',
  archived: 'Archived',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function stampClass(status) {
  if (status === 'confirmed') return 'stamp-confirmed';
  if (status === 'adjust') return 'stamp-adjust';
  if (status === 'draft') return 'stamp-draft';
  return 'stamp-inflight';
}

function answeredCount(card) {
  if (!card || !card.rawAnswers) return 0;
  const real = card.rawAnswers.filter((a) => (a.answer || '').trim().length > 0);
  if (real.some((a) => a.questionIndex === null || a.questionIndex === undefined)) return 4; // single-pass dump covers all four
  return Math.min(real.length, 4);
}

/* FR-12: flags render as plain-language nudges, never as jargon. */
const FLAG_NUDGES = {
  'NEEDS-OWNER': 'Who made the call here? Name them plainly.',
  'COULD-BE-HIGHER': 'This might be higher than claimed — if it is, say it plainly in your words and fix the label.',
  'NEEDS-2A': 'A created-direction claim needs the project details: who shaped it, who decided, who carried it, and how many came after you.',
  'NEEDS-INVOLVEMENT': 'Say what YOU did in this — whose hands, what pass.',
  'FLOOR-BLOCKS-CLIMB': 'Someone still refines this work before it goes out, so a direction claim can’t stand on this project.',
  STALE: 'Filed a while after the work closed — context for your reviewer, never a penalty.',
  'PROPOSED-BOLT-IN': 'This extra skill isn’t on the recognized list — it’s recorded, and JP will look at it.',
  'THIN-POOL': 'This went through the fallback path because no valid confirmer existed.',
  'NOT-TRIGGERED': 'Nothing on record here — that’s a valid state, not a gap.',
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
