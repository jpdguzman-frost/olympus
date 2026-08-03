/** HttpError — thrown by services, translated by errorHandler. */

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function badRequest(message, extra) {
  return new HttpError(400, message, extra);
}

export function forbidden(message = 'Forbidden', extra) {
  return new HttpError(403, message, extra);
}

export function notFound(message = 'Not found', extra) {
  return new HttpError(404, message, extra);
}

export function conflict(message, extra) {
  return new HttpError(409, message, extra);
}
