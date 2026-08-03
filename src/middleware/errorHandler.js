/** Last-mounted error handler — HttpError → its status; everything else → 500. */

import { HttpError } from '../utils/httpError.js';
import { sendErrorResponse } from '../utils/responseEnvelope.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return sendErrorResponse(res, err.status, err.message, err.extra);
  }
  console.error('[errorHandler]', err);
  return sendErrorResponse(res, 500, 'Internal server error');
}
