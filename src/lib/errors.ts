export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'error',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to do this') => new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new ApiError(404, msg, 'not_found');
export const conflict = (msg: string, details?: unknown) => new ApiError(409, msg, 'conflict', details);
export const tooMany = (msg = 'Too many requests', retryAfter?: number) =>
  new ApiError(429, msg, 'rate_limited', { retryAfter });
