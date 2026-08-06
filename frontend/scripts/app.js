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
    home: { confirmed: [], drafts: [], archived: [], inFlight: [], track: null },
    queue: [],
    signoffs: [],
    myProjects: [],
    capsContext: null,
    summaryText: null,
    chatInput: '',
    chatBusy: false,
    chatDone: false,
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
    nomineePick: null,
    notice: null,
    actionError: null,
    refuseText: '',
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
    const card = await api('POST', '/api/cards', { captureMode: 'conversation' });
    window.location.hash = `#/card/${card._id}`;
  },

  // B7: file a project straight from the home list.
  async fileProject(project) {
    this.set({ error: null });
    try {
      const card = await api('POST', '/api/cards', {
        subjectName: project.projectName,
        closeDate: project.tenure?.to ? String(project.tenure.to).slice(0, 10) : null,
        captureMode: 'conversation',
      });
      window.location.hash = `#/card/${card._id}`;
    } catch (err) {
      this.set('error', err.message);
    }
  },

  // B7: one talent turn in the capture conversation.
  async sendChat(forcedText = null) {
    const text = forcedText ?? this.get('chatInput');
    if (this.get('chatBusy')) return;
    this.set({ chatBusy: true, actionError: null });
    try {
      const result = await api('POST', `/api/cards/${this.get('card._id')}/converse`, { text });
      this.set({
        'card.conversation': result.conversation,
        chatInput: '',
        chatDone: Boolean(result.turn?.done),
        canSubmit: Boolean(result.canSubmit),
      });
    } catch (err) {
      this.set('actionError', err.message);
    } finally {
      this.set('chatBusy', false);
    }
  },

  async wrapChat() {
    await this.sendChat("That's everything from me — let's wrap up.");
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
      if (this.get('card.captureMode') !== 'conversation') await saveNow();
      const result = await api('POST', `/api/cards/${this.get('card._id')}/submit`);
      if (result.structuring === 'pending-p3') {
        this.set(
          'submitMessage',
          'Saved. Your words are on record. In about a minute the app turns them into lines for you to check.',
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
    await this.claimAction(claim, { action: 'fix', labels, concessionReason: claim.concessionText || null });
  },

  async removeClaim(claim) {
    await this.claimAction(claim, { action: 'fix', remove: true, concessionReason: claim.concessionText || null });
  },

  // A4: anchor a line — when it was, and where, in the talent's words.
  async anchorClaim(claim) {
    await this.claimAction(claim, { action: 'anchor', statement: claim.anchorInput });
  },

  // JP's thin-line rule: add the missing piece; the AI re-checks the line.
  async addDetail(claim) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/decide`, {
        action: 'add-detail',
        statement: claim.detailText,
      });
      this.set('notice', 'Got it — your detail is saved and the line is being re-checked. The answer lands here in about a minute.');
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  // A4: contest a line against its traceback — the AI re-checks it.
  async contestClaim(claim) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/decide`, {
        action: 'contest',
        statement: claim.contestText,
      });
      this.set('notice', "Got it — the line is being re-checked against your words. The answer lands here in about a minute.");
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  // A4: bring an archived draft back — nothing was lost.
  async reviveCard(card) {
    this.set({ error: null });
    try {
      const revived = await api('POST', `/api/cards/${card._id}/revive`);
      window.location.hash = `#/card/${revived._id}`;
    } catch (err) {
      this.set('error', err.message);
    }
  },

  // C1: stand by an adjusted claim as written — the defence goes on the record.
  async defendClaim(claim) {
    await this.claimAction(claim, { action: 'defend', statement: claim.defenseText });
  },

  // A1: exposure sign-off — one line on how you know the pick saw the work.
  async confirmSignoff(row) {
    this.set({ error: null });
    try {
      await api('POST', `/api/cards/${row._id}/signoff`, { action: 'confirm', note: row.confirmNote });
      await loadHome();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async refuseSignoff(row) {
    this.set({ error: null });
    try {
      await api('POST', `/api/cards/${row._id}/signoff`, { action: 'refuse', reason: row.refuseReason });
      await loadHome();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  // C1: post-ruling refusal — final position logged, card goes to the fallback.
  async refuseRuling() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/refuse-ruling`, {
        statement: this.get('refuseText'),
      });
      this.set('notice', 'Your final word is saved. The card goes to a backup reviewer. No one writes a call in your name.');
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
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
      this.set('notice', 'Answer saved.');
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
      this.set({ candidates, nominating: true, nomineePick: null });
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async submitNomination() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/nominate`, {
        nomineeId: this.get('nomineePick'),
      });
      this.set({ nominating: false, notice: 'Your pick is in. Someone who knows the work gives it a quick check next.' });
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
      this.set({ nominating: false, notice: 'Sent through the backup path — marked so everyone can see.' });
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
        // A5: Confirmed carries its attestation; Adjust carries its note.
        note: (verdict === 'Confirmed' ? claim.attestation : claim.adjustNote) || null,
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
  const [home, queue, signoffs, myProjects] = await Promise.all([
    api('GET', '/api/home'),
    api('GET', '/api/queue'),
    api('GET', '/api/signoffs'),
    api('GET', '/api/caps/catch-up').catch(() => []),
  ]);
  app.set({ home, queue, signoffs, myProjects, view: 'home' });
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
      isReviewScreen:
        ['routed', 'ruled', 'reassigned'].includes(card.status) &&
        String(card.nomination?.routedTo) === String(me.id),
      refuseText: '',
      vocabFields: Object.keys(track.controlledVocabulary || {}),
      approvedCount: (card.claims || []).filter((c) => c.talentApproved).length,
      nominating: false,
      nomineePick: null,
    });
    return;
  }
  const track = home.track || { questionSet: [], competencyOrDomainList: [] };

  if (card.captureMode === 'conversation') {
    app.set({
      view: 'capture',
      card,
      track,
      summaryText: null,
      chatInput: '',
      chatBusy: false,
      chatDone: false,
      canSubmit: (card.sweepAnswers || []).length > 0,
      saveState: 'idle',
    });
    if (card.subject.name) {
      api('GET', `/api/caps/summary?project=${encodeURIComponent(card.subject.name)}`)
        .then((sum) => app.set('summaryText', sum ? sum.text : null))
        .catch(() => {});
    }
    const convo = card.conversation || [];
    if (!convo.length || convo[convo.length - 1].role === 'talent') app.sendChat('');
    return;
  }

  const answers = ['', '', '', ''];
  let singleText = '';
  for (const a of card.rawAnswers || []) {
    if (a.questionIndex === null || a.questionIndex === undefined) singleText = a.answer;
    else if (a.questionIndex >= 0 && a.questionIndex < 4) answers[a.questionIndex] = a.answer;
  }
  const answeredIdx = answers.reduce((acc, a, i) => ((a || '').trim() ? i : acc), 0);
  const context = await api('GET', '/api/cards/context');
  const capsContext = card.subject.name
    ? await api('GET', `/api/caps/context?project=${encodeURIComponent(card.subject.name)}`).catch(() => null)
    : null;

  app.set({
    view: 'capture',
    card,
    track,
    questions: track.questionSet || [],
    context: context.filter((c) => c._id !== card._id),
    capsContext,
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
  if (card.captureMode === 'conversation') return; // B7: turns save server-side, form state is irrelevant
  app.set('saveState', 'saving');
  try {
    const updated = await api('PATCH', `/api/cards/${card._id}`, buildPatch());
    app.set('card.periodTag', updated.periodTag);
    app.set('saveState', 'saved');
  } catch (err) {
    app.set('saveState', 'idle');
    app.set('error', `Saving failed: ${err.message} — your text is still here. Try again.`);
    throw err;
  }
}

const scheduleSave = debounce(() => {
  savePromise = saveNow().catch(() => {});
}, 700);

app.observe('answers.* singleText sweepText subjectName closeDateStr', () => {
  if (app.get('view') !== 'capture') return;
  if (app.get('card.captureMode') === 'conversation') return;
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
