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
    postWrapOpen: false, // JP (Aug 6): after the wrap, the box collapses to a link
    structuringWait: false, // sent — the page waits, then moves to the write-up on its own
    structuringSlow: false,
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
    // C2v2 document screen state
    isDocScreen: false,
    isAdjustScreen: false,
    checkerPick: '',
    checkerPickName: '',
    docReady: 0,
    docAside: 0,
    docLeftOut: 0,
    sendSummary: '',
    needsResend: false,
    boltInsView: [],
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
    openContention: (claim) => (claim.contentions || []).some((c) => c.outcome === null),
    hasThreadWords: (t) => (t.thread || []).some((x) => x.role === 'talent'),
    checkerName: (id) => {
      const routes = app.get('card.nomination.routes') || [];
      const hit = routes.find((r) => String(r.reviewerId) === String(id));
      if (hit) return hit.name;
      const cand = (app.get('candidates') || []).find((c) => String(c._id) === String(id));
      return cand ? cand.name : '—';
    },
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
      // A fresh wrap closes the box back down to the link.
      if (result.turn?.done) this.set('postWrapOpen', false);
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
        if (this.get('card.captureMode') === 'conversation') {
          // JP (Aug 6): the page waits visibly, then moves to the
          // write-up screen on its own the moment the lines land.
          this.set({ structuringWait: true, structuringSlow: false });
          pollStructuring(this.get('card._id'));
        } else {
          this.set(
            'submitMessage',
            'Saved. Your words are on record. In about a minute the app turns them into lines for you to check.',
          );
        }
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

  // --- C2v2 document screen: per-line threads, context, left-out, send ---

  toggleContext(ci) {
    const claim = this.get(`card.claims.${ci}`);
    if (!claim.showContext) {
      this.set(`card.claims.${ci}.contextTurns`, contextTurnsFor(this.get('card'), claim));
    }
    this.set(`card.claims.${ci}.showContext`, !claim.showContext);
  },

  toggleThread(ci) {
    this.toggle(`card.claims.${ci}.threadOpen`);
  },

  toggleLeftOut(ci) {
    this.toggle(`card.claims.${ci}.leftOut`);
  },

  async threadSend(claim, ci) {
    if (!(claim.threadInput || '').trim()) return;
    this.set({ notice: null, actionError: null });
    try {
      const result = await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/thread`, {
        text: claim.threadInput,
      });
      this.set(`card.claims.${ci}.threadInput`, '');
      this.set(`card.claims.${ci}.thread`, result.thread);
      if (result.turn.ready) {
        await this.refreshDetail();
        pollDetailSoon();
      }
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async threadClose(claim) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/claims/${claim._id}/thread`, { close: true });
      this.set('notice', 'Got it — the line is being re-checked against your words. The answer lands on the line in about a minute.');
      await this.refreshDetail();
      pollDetailSoon();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async startBoltIn(item) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/bolt-in`, { competency: item.name });
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async startSignalClaim(sig) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/bolt-in`, { signal: sig.signal });
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async boltInSend(thread) {
    if (!(thread.input || '').trim()) return;
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/bolt-in`, { threadId: thread._id, text: thread.input });
      await this.refreshDetail();
      pollDetailSoon();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  async boltInClose(thread) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/bolt-in`, { threadId: thread._id, close: true });
      await this.refreshDetail();
      pollDetailSoon();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  boltInReopen(thread) {
    const idx = (this.get('card.boltInThreads') || []).findIndex((t) => String(t._id) === String(thread._id));
    if (idx >= 0) this.set(`card.boltInThreads.${idx}.status`, 'open');
  },

  // JP (Aug 6): opened one, changed your mind — toggle it off.
  async boltInDismiss(thread) {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/bolt-in`, { threadId: thread._id, dismiss: true });
      await this.refreshDetail();
    } catch (err) {
      this.set('actionError', err.message);
    }
  },

  // THE one send: reading was the review; this is the approval.
  async sendCard() {
    this.set({ notice: null, actionError: null });
    const card = this.get('card');
    const lineOverrides = {};
    const unticked = [];
    for (const c of card.claims || []) {
      if (c.leftOut) unticked.push(c._id);
      if (c.overridePick) lineOverrides[c._id] = c.overridePick;
    }
    try {
      await api('POST', `/api/cards/${card._id}/send`, {
        checkerId: this.get('checkerPick') || null,
        lineOverrides,
        unticked,
      });
      this.set('notice', 'Sent. Someone who saw the work checks it next. Set-aside lines stayed behind as drafts — no penalty.');
      await this.refreshDetail();
    } catch (err) {
      const failures = err.failures?.map((f) => `${f.nominee}: ${f.reason}`).join(' · ');
      this.set('actionError', failures || err.message);
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

  // A1: exposure sign-off — one line on how you know the pick saw the
  // work. Per pick (C2v2): a card can carry more than one.
  async confirmSignoff(row) {
    this.set({ error: null });
    try {
      await api('POST', `/api/cards/${row._id}/signoff`, { action: 'confirm', note: row.confirmNote, reviewerId: row.reviewerId });
      await loadHome();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async refuseSignoff(row) {
    this.set({ error: null });
    try {
      await api('POST', `/api/cards/${row._id}/signoff`, { action: 'refuse', reason: row.refuseReason, reviewerId: row.reviewerId });
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

  async submitThinPool() {
    this.set({ notice: null, actionError: null });
    try {
      await api('POST', `/api/cards/${this.get('card._id')}/send`, { thinPool: true });
      this.set({ notice: 'Sent through the backup path — marked so everyone can see.' });
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
    // C2v2 document screen: one read, one send; per-line threads.
    const isDocScreen = isOwn && ['structured', 'talent-approved', 'exposure-signoff'].includes(card.status);
    const isAdjustScreen = isOwn && card.status === 'adjust';
    const THIN = 'insufficient detail — draft';
    for (const c of card.claims || []) {
      c.aside = !c.anchorText || (c.flags || []).includes(THIN);
      c.leftOut = false;
      c.overridePick = '';
      c.threadOpen = false;
      c.threadInput = '';
      c.showContext = false;
    }
    const candidates = isDocScreen ? await api('GET', '/api/nominee-candidates').catch(() => []) : [];
    const boltInsView = (track.boltIns || []).map((name) => ({
      name,
      // claimed = an actual line exists; open = a thread is in progress
      // below (dismissable — JP, Aug 6). Never conflate the two.
      claimed: (card.claims || []).some((c) => c.competencyOrDomain === name),
      open: (card.boltInThreads || []).some((t) => t.competency === name && ['open', 'structuring'].includes(t.status)),
    }));
    app.set({
      view: 'detail',
      card,
      track,
      isDocScreen,
      isAdjustScreen,
      isConfirmScreen: isDocScreen || isAdjustScreen,
      isReviewScreen:
        ['routed', 'ruled', 'reassigned'].includes(card.status) &&
        ((card.claims || []).some((c) => String(c.checkerId) === String(me.id)) ||
          String(card.nomination?.routedTo) === String(me.id)),
      refuseText: '',
      vocabFields: Object.keys(track.controlledVocabulary || {}),
      approvedCount: (card.claims || []).filter((c) => c.talentApproved).length,
      candidates,
      checkerPick: String(card.nomination?.routes?.[0]?.reviewerId ?? ''),
      boltInsView,
      needsResend:
        isDocScreen &&
        card.status !== 'structured' &&
        ((card.claims || []).some((c) => c.needsRelook || (c.talentApproved && !c.checkerId && !c.verdict)) ||
          !(card.nomination?.routes || []).length),
      nominating: false,
      nomineePick: null,
    });
    recountDoc();
    // Something is still being written or re-checked — refresh shortly.
    const pending =
      (card.claims || []).some((c) => (c.contentions || []).some((x) => x.outcome === null)) ||
      (card.boltInThreads || []).some((t) => t.status === 'structuring');
    if (pending) pollDetailSoon();
    return;
  }
  const track = home.track || { questionSet: [], competencyOrDomainList: [] };

  if (card.captureMode === 'conversation') {
    // A refresh keeps the wrap state: the conversation is persisted, so
    // "done" is read from it — the last saved turn being the AI's wrap.
    const convo = card.conversation || [];
    const lastSaved = convo[convo.length - 1];
    const waiting = Boolean(card.submittedForStructuringAt); // sent, lines not landed yet
    app.set({
      view: 'capture',
      card,
      track,
      summaryText: null,
      chatInput: '',
      chatBusy: false,
      chatDone: lastSaved?.role === 'ai' && lastSaved?.kind === 'wrap',
      postWrapOpen: false,
      structuringWait: waiting,
      structuringSlow: false,
      canSubmit: (card.sweepAnswers || []).length > 0,
      saveState: 'idle',
    });
    if (waiting) {
      pollStructuring(card._id);
      return; // no new chat turn while the write-up is being made
    }
    if (card.subject.name) {
      api('GET', `/api/caps/summary?project=${encodeURIComponent(card.subject.name)}`)
        .then((sum) => app.set('summaryText', sum ? sum.text : null))
        .catch(() => {});
    }
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
// C2v2 document screen helpers
// ---------------------------------------------------------------------------

/** Ready / set-aside / left-out counts + the "N lines to X" send summary. */
function recountDoc() {
  const card = app.get('card');
  if (!card || !app.get('isDocScreen')) return;
  const claims = card.claims || [];
  const live = claims.filter((c) => !c.aside && !c.leftOut && !c.verdict);
  app.set({
    docReady: live.length,
    docAside: claims.filter((c) => c.aside && !c.verdict).length,
    docLeftOut: claims.filter((c) => c.leftOut).length,
  });
  const cands = app.get('candidates') || [];
  const pickName = (id) => (cands.find((c) => String(c._id) === String(id)) || {}).name || '';
  const pick = app.get('checkerPick');
  app.set('checkerPickName', pickName(pick));
  const groups = {};
  for (const c of live) {
    const to = c.overridePick || pick;
    if (!to) continue;
    const nm = pickName(to) || 'your pick';
    groups[nm] = (groups[nm] || 0) + 1;
  }
  const parts = Object.entries(groups).map(([nm, n]) => `${n} line${n === 1 ? '' : 's'} to ${nm}`);
  app.set('sendSummary', parts.length ? `${parts.join(' · ')}.` : `${live.length} line(s) ready.`);
}

app.observe(
  'checkerPick card.claims.*.overridePick card.claims.*.leftOut',
  () => {
    if (app.get('view') === 'detail') recountDoc();
  },
  { init: false },
);

/** One quiet refresh while a line is being re-checked or written up. */
let pollTimer = null;
function pollDetailSoon(ms = 20000) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (app.get('view') === 'detail') app.refreshDetail().catch(() => {});
  }, ms);
}

/**
 * After "Send it in": watch the card until the structurer lands, then
 * move to the write-up screen on its own (JP, Aug 6). ~96s in, soften
 * the message — the worker retries on its own; nothing is lost.
 */
let structuringTimer = null;
function pollStructuring(cardId, attempt = 0) {
  clearTimeout(structuringTimer);
  structuringTimer = setTimeout(async () => {
    if (app.get('view') !== 'capture' || String(app.get('card._id')) !== String(cardId)) return;
    try {
      const card = await api('GET', `/api/cards/${cardId}`);
      // Moved on → the write-up screen. Handed back (zero-lines give-up)
      // → the chat, with the AI's plain note and the send bar back.
      if (card.status !== 'draft' || !card.submittedForStructuringAt) {
        await loadCapture(cardId);
        return;
      }
    } catch (err) {
      /* transient — keep watching */
    }
    if (attempt >= 11) app.set('structuringSlow', true);
    pollStructuring(cardId, attempt + 1);
  }, 8000);
}

/** The quote, shown inside the conversation it came from. */
function contextTurnsFor(card, claim) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(claim.sourceQuote);
  const convo = card.conversation || [];
  const idx = convo.findIndex((t) => t.role === 'talent' && norm(t.text).includes(q));
  if (idx >= 0) {
    return convo
      .slice(Math.max(0, idx - 1), idx + 2)
      .map((t) => ({ role: t.role, text: t.text, hit: t === convo[idx] }));
  }
  const ra = (card.rawAnswers || []).find((a) => norm(a.answer).includes(q));
  if (ra) {
    return [
      { role: 'ai', text: ra.question, hit: false },
      { role: 'talent', text: ra.answer, hit: true },
    ];
  }
  return [{ role: 'talent', text: claim.sourceQuote, hit: true }];
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
