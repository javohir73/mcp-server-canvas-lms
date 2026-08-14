export type CanvasErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | 'NETWORK'
  | 'UNSAFE_URL';

export class CanvasError extends Error {
  constructor(
    public readonly code: CanvasErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}
