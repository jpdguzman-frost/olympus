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
