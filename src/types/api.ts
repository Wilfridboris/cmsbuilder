/**
 * Standard API response envelope (architecture.md — API & Communication).
 * Every route handler returns this shape so the client can always check
 * `error` before consuming `data`.
 *
 * Story 1.1 provides the shared types only; route handlers are owned by
 * later stories.
 */
export type ApiResponse<T> = {
  data: T | null;
  error: string | null;
};

/** Separates a technical error from the user-facing message. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly userMessage: string;

  constructor(statusCode: number, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}
