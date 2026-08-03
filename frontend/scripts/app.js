/* Talent app: home + capture, hash-routed. */

const app = new Ractive({
  target: '#app',
  template: templateById('tpl-root'),
  partials: {
    home: templateById('tpl-home'),
    capture: templateById('tpl-capture'),
    detail: templateById('tpl-detail'),
  },
  data: {
    view: 'loading',
    me: null,
    isTalent: false,
    isLead: false,
    isAdmin: false,
    error: null,
    home: { confirmed: [], drafts: [], inFlight: [], track: null },
    queue: [],
    ladder: null,
    quarters: {},
    quarterTags: [],
    // capture state
    card: null,
    track: { competencyOrDomainList: [] },
    questions: [],
    context: [],
    mode: 'guided',
    guidedIndex: 0,
    answers: ['', '', '', ''],
    singleText: '',
    sweepText: '',
    subjectName: '',
    closeDateStr: '',
    saveState: 'idle',
    submitMessage: null,
    submitError: null,
    canSubmit: false,
    sweepVisible: false,
    // detail/confirm state
    isConfirmScreen: false,
    isReviewScreen: false,
    vocabFields: [],
    approvedCount: 0,
    nominating: false,
    candidates: [],
    nomineePick: [],
    notice: null,
    actionError: null,
    // helpers usable in templates
    statusLabel,
    stampClass,
    answeredCount,
    fmtDate,
    flagNudge,
  },

  async logout() {
    await api('POST', '/auth/logout');
    window.location.href = '/login.html';
  },

  async startCard() {
    const card = await api('POST', '/api/cards', {});
    window.location.hash = `#/card/${card._id}`;
  },

  openCard(id) {
    window.location.hash = `#/card/${id}`;
  },

  goHome() {
    window.location.hash = '';
  },

  setMode(mode) {
    this.set('mode', mode);
    this.set('card.captureMode', mode);
    scheduleSave();
    refreshDerived();
  },

  nextQuestion() {
    this.set('guidedIndex', Math.min(3, this.get('guidedIndex') + 1));
  },

  notMe() {
    this.set('sweepText', 'Not me for the rest.');
    saveNow();
  },

  async submitCard() {
    this.set({ submitMessage: null, submitError: null });
    try {
      await saveNow();
      const result = await api('POST', `/api/cards/${this.get('card._id')}/submit`);
      if (result.structuring === 'pending-p3') {
        this.set(
          'submitMessage',
          'On record. Your words are saved — structuring picks this card up within a minute.',
        );
      }
    } catch (err) {
      this.set('submitError', err.message);
    }
  },

  // --- Confirm screen (FR-12) ---

  async refreshDetail() {
    await loadCapture(this.get('card._id'));
  },

  async approveClaim(claim) {
    await this.claimAction(claim, { action: 'approve' });
  },

  startFix(claim, index) {
    const editLabels = {};
    for (const [field, value] of Object.entries(claim.labels || {})) editLabels[field] = value;
    this.set(`card.claims.${index}.editLabels`, editLabels);
    this.set(`card.claims.${index}.editing`, true);
  },

  async saveFix(claim, index) {
    const picked = this.get(`card.claims.${index}.editLabels`) || {};
    const labels = {};
    for (const [field, value] of Object.entries(picked)) if (value) labels[field] = value;
    await this.claimAction(claim, { action: 'fix', labels });
  },

  async removeClaim(claim) {
    await this.claimAction(claim, { action: 'fix', remove: true });
  },

  async claimAction(claim, body) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/decide`, body);
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async answerFollowUp(followUp) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/follow-ups/${followUp._id}/answer`, {
        answer: followUp.answer,
      });
      this.set('notice', 'Answer saved with your words.');
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async openNomination() {
    this.set({ notice: null, actionError: null });
    try {
      if (this.get('card.status') === 'structured') {
        await api('POST', `/api/cards/${this.get('card._id')}/approve`);
        await this.refreshDetail();
      }
      const candidates = await api('GET', '/api/nominee-candidates');
      this.set({ candidates, nominating: true, nomineePick: [] });
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async submitNomination() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/nominate`, {
        nomineeIds: this.get('nomineePick'),
      });
      this.set({ nominating: false, notice: 'Sent to your Lead for exposure approval.' });
      await this.refreshDetail();
    } catch (err) {
      const failures = err.failures?.map((f) => `${f.nominee}: ${f.reason}`).join(' · ');
      this.set('actionError', failures || err.message);
    }
  },

  async submitThinPool() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/nominate`, { thinPool: true });
      this.set({ nominating: false, notice: 'Routed through the fallback path, visibly marked.' });
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async rerouteCard() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/reroute`);
      this.set('notice', 'Sent back to your reviewer.');
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  // --- Reviewer screen (FR-16) ---

  async sendVerdict(claim, verdict) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/verdict`, {
        verdict,
        note: claim.adjustNote || null,
      });
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function route() {
  app.set({ error: null, submitMessage: null, submitError: null });
  const hash = window.location.hash;
  const cardMatch = hash.match(/^#\/card\/([a-f0-9]+)$/);
  try {
    if (cardMatch) {
      await loadCapture(cardMatch[1]);
    } else {
      await loadHome();
    }
  } catch (err) {
    app.set('error', err.message);
    app.set('view', 'home');
  }
}

async function loadHome() {
  const [home, queue] = await Promise.all([api('GET', '/api/home'), api('GET', '/api/queue')]);
  app.set({ home, queue, view: 'home' });
  if (app.get('isTalent')) {
    const [ladder, quarters] = await Promise.all([api('GET', '/api/ladder'), api('GET', '/api/quarters')]);
    app.set({ ladder, quarters, quarterTags: Object.keys(quarters).sort().reverse() });
  }
}

async function loadCapture(cardId) {
  const [card, home] = await Promise.all([api('GET', `/api/cards/${cardId}`), api('GET', '/api/home')]);
  if (card.status !== 'draft') {
    const me = app.get('me');
    const track = home.track || { controlledVocabulary: {} };
    const isOwn = String(card.talentId) === String(me.id);
    app.set({
      view: 'detail',
      card,
      track,
      isConfirmScreen: isOwn && !card.inCalibration && ['structured', 'adjust'].includes(card.status),
      isReviewScreen: card.status === 'routed' && String(card.nomination?.routedTo) === String(me.id),
      vocabFields: Object.keys(track.controlledVocabulary || {}),
      approvedCount: (card.claims || []).filter((c) => c.talentApproved).length,
      nominating: false,
      nomineePick: [],
    });
    return;
  }
  const track = home.track || { questionSet: [], competencyOrDomainList: [] };
  const answers = ['', '', '', ''];
  let singleText = '';
  for (const a of card.rawAnswers || []) {
    if (a.questionIndex === null || a.questionIndex === undefined) singleText = a.answer;
    else if (a.questionIndex >= 0 && a.questionIndex < 4) answers[a.questionIndex] = a.answer;
  }
  const answeredIdx = answers.reduce((acc, a, i) => ((a || '').trim() ? i : acc), 0);
  const context = await api('GET', '/api/cards/context');

  app.set({
    view: 'capture',
    card,
    track,
    questions: track.questionSet || [],
    context: context.filter((c) => c._id !== card._id),
    mode: card.captureMode === 'single-pass' ? 'single-pass' : 'guided',
    guidedIndex: Math.max(answeredIdx, 0),
    answers,
    singleText,
    sweepText: (card.sweepAnswers && card.sweepAnswers[0] && card.sweepAnswers[0].answer) || '',
    subjectName: card.subject.name || '',
    closeDateStr: toDateInput(card.closeDate),
    saveState: 'idle',
  });
  refreshDerived();
}

// ---------------------------------------------------------------------------
// Autosave (Invariant 15: raw persists as you type)
// ---------------------------------------------------------------------------

function buildPatch() {
  const mode = app.get('mode');
  const questions = app.get('questions');
  const rawAnswers = [];
  if (mode === 'single-pass') {
    const dump = app.get('singleText');
    if ((dump || '').trim()) rawAnswers.push({ questionIndex: null, question: 'single-pass', answer: dump });
  } else {
    app.get('answers').forEach((answer, i) => {
      if ((answer || '').trim()) rawAnswers.push({ questionIndex: i, question: questions[i], answer });
    });
  }
  const sweepText = app.get('sweepText');
  const patch = {
    subjectName: app.get('subjectName'),
    captureMode: mode,
    rawAnswers,
    sweepAnswers: (sweepText || '').trim()
      ? [{ prompt: 'One last sweep — anything else you own here?', answer: sweepText }]
      : [],
  };
  const closeDateStr = app.get('closeDateStr');
  patch.closeDate = closeDateStr || null;
  return patch;
}

function refreshDerived() {
  const mode = app.get('mode');
  const answeredAll =
    mode === 'single-pass'
      ? (app.get('singleText') || '').trim().length > 0
      : app.get('answers').every((a) => (a || '').trim().length > 0);
  const sweepDone = (app.get('sweepText') || '').trim().length > 0;
  app.set('sweepVisible', answeredAll);
  app.set('canSubmit', answeredAll && sweepDone);
}

let savePromise = null;

async function saveNow() {
  const card = app.get('card');
  if (!card || card.status !== 'draft') return;
  app.set('saveState', 'saving');
  try {
    const updated = await api('PATCH', `/api/cards/${card._id}`, buildPatch());
    app.set('card.periodTag', updated.periodTag);
    app.set('saveState', 'saved');
  } catch (err) {
    app.set('saveState', 'idle');
    app.set('error', `Autosave failed: ${err.message} — your text is still in this page; try again.`);
    throw err;
  }
}

const scheduleSave = debounce(() => {
  savePromise = saveNow().catch(() => {});
}, 700);

app.observe('answers.* singleText sweepText subjectName closeDateStr', () => {
  if (app.get('view') !== 'capture') return;
  refreshDerived();
  scheduleSave();
}, { init: false });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    const me = await api('GET', '/api/me');
    app.set({
      me,
      isTalent: me.roles.includes('talent'),
      isLead: me.roles.includes('lead'),
      isAdmin: me.roles.includes('admin'),
    });
    window.addEventListener('hashchange', route);
    await route();
  } catch (err) {
    /* api() already redirected on 401 */
  }
})();
