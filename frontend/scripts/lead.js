/* Lead page (as amended by A1/C4): read-only — reports + confirmed records. */

const app = new Ractive({
  target: '#app',
  template: templateById('tpl-lead'),
  data: {
    me: null,
    error: null,
    notice: null,
    isTalent: false,
    isAdmin: false,
    reports: [],
    cards: [],
    fmtDate,
  },

  async logout() {
    await api('POST', '/auth/logout');
    window.location.href = '/login.html';
  },
});

async function refresh() {
  const [reports, cards] = await Promise.all([
    api('GET', '/api/team/reports'),
    api('GET', '/api/team/cards'),
  ]);
  app.set({ reports, cards });
}

(async function boot() {
  try {
    const me = await api('GET', '/api/me');
    if (!me.roles.includes('lead')) {
      window.location.href = '/';
      return;
    }
    app.set({ me, isTalent: me.roles.includes('talent'), isAdmin: me.roles.includes('admin') });
    await refresh();
  } catch (err) {
    app.set('error', err.message);
  }
})();
