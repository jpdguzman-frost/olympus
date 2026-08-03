/* Admin page: users, tracks, audit trail. */

const app = new Ractive({
  target: '#app',
  template: templateById('tpl-admin'),
  data: {
    me: null,
    error: null,
    notice: null,
    users: [],
    leads: [],
    tracks: [],
    audit: [],
    roleOptions: ['talent', 'lead', 'nonadvocate', 'admin'],
    newUser: { name: '', email: '', roles: [], track: '', leadId: '' },
    fmtDate,
  },

  async logout() {
    await api('POST', '/auth/logout');
    window.location.href = '/login.html';
  },

  async addUser() {
    this.set({ error: null, notice: null });
    try {
      const draft = this.get('newUser');
      await api('POST', '/api/admin/users', {
        name: draft.name,
        email: draft.email,
        roles: draft.roles,
        track: draft.track || null,
        leadId: draft.leadId || null,
      });
      this.set({
        notice: `${draft.name} added.`,
        newUser: { name: '', email: '', roles: [], track: '', leadId: '' },
      });
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async toggleActive(user) {
    this.set({ error: null, notice: null });
    try {
      await api('PATCH', `/api/admin/users/${user._id}`, { active: !user.active });
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },
});

async function refresh() {
  const [users, tracks, audit] = await Promise.all([
    api('GET', '/api/admin/users'),
    api('GET', '/api/admin/tracks'),
    api('GET', '/api/admin/audit'),
  ]);
  app.set({
    users,
    tracks,
    audit: audit.slice(0, 25),
    leads: users.filter((u) => u.roles.includes('lead') && u.active),
  });
}

(async function boot() {
  try {
    const me = await api('GET', '/api/me');
    if (!me.roles.includes('admin')) {
      window.location.href = '/';
      return;
    }
    app.set({ me });
    await refresh();
  } catch (err) {
    app.set('error', err.message);
  }
})();
