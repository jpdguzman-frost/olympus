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
    shellReportId: '',
    shellSubject: '',
    shellCloseDate: '',
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
    const [reports, cards] = await Promise.all([
      api('GET', '/api/team/reports'),
      api('GET', '/api/team/cards'),
    ]);
    app.set({ reports, cards });
  } catch (err) {
    app.set('error', err.message);
  }
})();
