export class HttpError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, 'bad_request', message, details)
}

export function notFound(message = 'Не найдено'): HttpError {
  return new HttpError(404, 'not_found', message)
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 'conflict', message)
}

/** Normalise provider/tool errors into the API error envelope. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error
  const err = error as Error & { code?: string; status?: number; provider?: string }
  const message = err?.message ?? String(error)
  if (err?.code === 'cancelled') return new HttpError(499, 'cancelled', message)
  if (err?.code === 'auth_error' || err?.status === 401) return new HttpError(401, 'auth_error', message)
  if (err?.code === 'rate_limit' || err?.status === 429) return new HttpError(429, 'rate_limit', message)
  if (err?.code === 'timeout') return new HttpError(504, 'timeout', message)
  if (err?.code === 'path_escape') return new HttpError(403, 'path_escape', message)
  if (err?.code) return new HttpError(400, err.code, message)
  return new HttpError(500, 'internal_error', message)
}
