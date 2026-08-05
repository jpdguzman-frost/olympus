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
    activeUsers: [],
    tracks: [],
    audit: [],
    calibration: [],
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

  async saveSettings(track) {
    this.set({ error: null, notice: null });
    try {
      await api('PATCH', `/api/admin/tracks/${track.key}/settings`, {
        fallbackReviewerId: track.fallbackReviewerId || null,
        exposureVerifierId: track.exposureVerifierId || null,
      });
      this.set('notice', `${track.label} settings saved and logged.`);
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  // "execution: I run it, decision: Someone else decided" → {execution: "I run it", ...}
  parseLabelEdit(text) {
    const labels = {};
    for (const pair of String(text || '').split(',')) {
      const idx = pair.indexOf(':');
      if (idx > 0) labels[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    return labels;
  },

  async correctClaim(card, claim) {
    this.set({ error: null, notice: null });
    try {
      const labels = this.parseLabelEdit(claim.editLabels);
      if (!Object.keys(labels).length) {
        this.set('error', 'Write the correction as field: value (comma-separated for several)');
        return;
      }
      await api('POST', `/api/admin/calibration/${card._id}/claims/${claim._id}`, {
        action: 'edit',
        labels: { ...claim.labels, ...labels },
      });
      this.set('notice', 'Correction saved and logged.');
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async removeClaim(card, claim) {
    this.set({ error: null, notice: null });
    try {
      await api('POST', `/api/admin/calibration/${card._id}/claims/${claim._id}`, { action: 'remove' });
      this.set('notice', 'Claim removed — logged as a correction.');
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },

  async releaseCard(card) {
    this.set({ error: null, notice: null });
    try {
      await api('POST', `/api/admin/calibration/${card._id}/release`);
      this.set('notice', `Released “${card.subject.name}” — the talent can now see their claims.`);
      await refresh();
    } catch (err) {
      this.set('error', err.message);
    }
  },
});

async function refresh() {
  const [users, tracks, audit, calibration] = await Promise.all([
    api('GET', '/api/admin/users'),
    api('GET', '/api/admin/tracks'),
    api('GET', '/api/admin/audit'),
    api('GET', '/api/admin/calibration'),
  ]);
  app.set({
    users,
    tracks,
    audit: audit.slice(0, 25),
    calibration,
    leads: users.filter((u) => u.roles.includes('lead') && u.active),
    activeUsers: users.filter((u) => u.active),
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
