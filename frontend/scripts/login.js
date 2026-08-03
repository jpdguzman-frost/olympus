/* Login page: Google when configured; dev picker otherwise (dev only). */

(async function initLogin() {
  const target = document.getElementById('login-actions');
  const params = new URLSearchParams(window.location.search);

  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  try {
    const res = await fetch('/auth/mode');
    const mode = (await res.json()).data;
    target.innerHTML = '';

    if (params.get('error') === 'denied') {
      target.appendChild(
        el('<p class="error-note">That account isn\'t on the Frost workspace, or isn\'t set up yet. Ask JP.</p>'),
      );
    }

    if (mode.google) {
      target.appendChild(el('<a class="btn btn-primary" href="/auth/google">Sign in with Google</a>'));
      target.appendChild(el('<p class="domain-note">Frost Design Group workspace accounts only.</p>'));
      return;
    }

    if (mode.devLogin) {
      const usersRes = await fetch('/auth/dev-users');
      const users = (await usersRes.json()).data;
      const picker = el('<div class="dev-picker"></div>');
      picker.appendChild(el('<div class="dev-note">DEV LOGIN — Google OAuth not configured. Never in production.</div>'));
      for (const user of users) {
        const btn = el(
          `<button class="dev-user"><span>${user.name}</span><span class="roles">${user.roles.join(' · ')}${user.track ? ' · ' + user.track : ''}</span></button>`,
        );
        btn.addEventListener('click', async () => {
          const login = await fetch('/auth/dev-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email }),
          });
          const result = await login.json();
          if (!result.ok) return alert(result.error);
          const roles = result.data.roles;
          if (roles.includes('admin')) window.location.href = '/admin.html';
          else if (roles.includes('lead') && !roles.includes('talent')) window.location.href = '/lead.html';
          else window.location.href = '/';
        });
        picker.appendChild(btn);
      }
      target.appendChild(picker);
      return;
    }

    target.appendChild(el('<p class="error-note">Sign-in is not configured. Ask JP.</p>'));
  } catch (err) {
    target.innerHTML = '';
    target.appendChild(el(`<p class="error-note">Can't reach the server: ${err.message}</p>`));
  }
})();
