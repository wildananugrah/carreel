/**
 * HttpError represents a known, expected error condition that should be
 * translated to a specific HTTP status code and a user-facing message.
 *
 * Throw HttpError from services for cases like:
 *   - Authentication failures → 401
 *   - Authorization failures → 403 (or 404 if you don't want to reveal existence)
 *   - Validation errors → 400
 *   - Not found → 404
 *   - Conflict → 409
 *
 * The error handler at the app level converts these to JSON responses with
 * the correct status code and message. Generic Error instances become 500
 * "Internal server error".
 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function unauthorized(message = "Unauthorized"): HttpError {
  return new HttpError(401, message);
}

export function forbidden(message = "Forbidden"): HttpError {
  return new HttpError(403, message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}
