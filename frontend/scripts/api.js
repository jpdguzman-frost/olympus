/* Fetch wrapper for the /api envelope. 401 → login page. */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not signed in');
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('The server sent an unreadable response');
  }
  if (!json.ok) {
    const err = new Error(json.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return json.data;
}
