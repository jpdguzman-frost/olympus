/** Uniform API response envelope (Ares parity). */

export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function sendErrorResponse(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}
