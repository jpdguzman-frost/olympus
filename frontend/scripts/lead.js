/* Lead page: shells (FR-5), reports, confirmed records. */

const app = new Ractive({
  target: '#app',
  template: templateById('tpl-lead'),
  data: {
    me: null,
    isTalent: false,
    isAdmin: false,
    error: null,
    notice: null,
    reports: [],
    cards: [],
    queue: [],
    shellReportId: '',
    shellSubject: '',
    shellCloseDate: '',
  },

  async approveNominee(card, nominee) {
    this.set({ error: null, notice: null });
    try {
      await api('POST', `/api/cards/${card._id}/nominee-decision`, {
        action: 'approve',
        approvedNomineeId: nominee.userId,
      });
      this.set('notice', `Routed “${card.subject.name}” to ${nominee.name}.`);
      await refreshQueue();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async rejectNominee(card) {
    this.set({ error: null, notice: null });
    try {
      await api('POST', `/api/cards/${card._id}/nominee-decision`, {
        action: 'reject',
        reason: card.rejectReason,
      });
      this.set('notice', `Returned the pick on “${card.subject.name}” to the talent.`);
      await refreshQueue();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async logout() {
    await api('POST', '/auth/logout');
    window.location.href = '/login.html';
  },

  async createShell() {
    this.set({ error: null, notice: null });
    try {
      const card = await api('POST', '/api/team/shells', {
        reportUserId: this.get('shellReportId'),
        subjectName: this.get('shellSubject'),
        closeDate: this.get('shellCloseDate'),
      });
      this.set({
        notice: `Shell opened: “${card.subject.name}” — it's in their drafts now.`,
        shellSubject: '',
        shellCloseDate: '',
      });
    } catch (err) {
      this.set('error', err.message);
    }
  },
});

async function refreshQueue() {
  app.set('queue', await api('GET', '/api/team/nominee-queue'));
}

(async function boot() {
  try {
    const me = await api('GET', '/api/me');
    if (!me.roles.includes('lead')) {
      window.location.href = '/';
      return;
    }
    app.set({
      me,
      isTalent: me.roles.includes('talent'),
      isAdmin: me.roles.includes('admin'),
    });
    const [reports, cards, queue] = await Promise.all([
      api('GET', '/api/team/reports'),
      api('GET', '/api/team/cards'),
      api('GET', '/api/team/nominee-queue'),
    ]);
    app.set({ reports, cards, queue });
  } catch (err) {
    app.set('error', err.message);
  }
})();
