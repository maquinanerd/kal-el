import type { FastifyInstance } from "fastify";
import { errorBody, API_ERROR_CODES } from "@kal-el/contracts";

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = "not found") =>
  new ApiHttpError(404, API_ERROR_CODES.NOT_FOUND, message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(409, API_ERROR_CODES.CONFLICT, message, details);

/**
 * 409s that an integrator must be able to branch on.
 *
 * These were previously thrown as a bare `CONFLICT` with the real code buried in
 * `details`, so a client could not tell a version clash from a slug clash from an
 * idempotency replay - all three arrived as `code: "CONFLICT"`.
 */
export const versionConflict = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(409, API_ERROR_CODES.VERSION_CONFLICT, message, details);
export const idempotencyReplay = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(409, API_ERROR_CODES.IDEMPOTENCY_REPLAY, message, details);
export const invalidTransition = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(409, API_ERROR_CODES.INVALID_TRANSITION, message, details);
export const forbidden = (message = "forbidden", details?: Record<string, unknown>) =>
  new ApiHttpError(403, API_ERROR_CODES.FORBIDDEN, message, details);
export const unauthorized = (message = "unauthenticated") =>
  new ApiHttpError(401, API_ERROR_CODES.UNAUTHENTICATED, message);
export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(400, API_ERROR_CODES.VALIDATION, message, details);

type PgErrorInfo = { code?: string; constraint?: string };

/** Drizzle >=0.45 wraps pg errors in DrizzleQueryError; unwrap to the pg code. */
function unwrapPgError(err: unknown): PgErrorInfo | null {
  const e = err as { code?: string; constraint?: string; cause?: unknown };
  if (e.code) return { code: e.code, constraint: e.constraint };
  const cause = e.cause;
  if (cause && typeof cause === "object") {
    const c = cause as PgErrorInfo;
    if (c.code) return { code: c.code, constraint: c.constraint };
  }
  return null;
}

export function isUniqueViolation(err: unknown): boolean {
  return unwrapPgError(err)?.code === "23505";
}

export function isForeignKeyViolation(err: unknown): boolean {
  return unwrapPgError(err)?.code === "23503";
}

export function isNotNullViolation(err: unknown): boolean {
  return unwrapPgError(err)?.code === "23502";
}

export function pgConstraint(err: unknown): string | undefined {
  return unwrapPgError(err)?.constraint;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    const requestId = (request as { id?: string }).id ?? "unknown";

    if (err instanceof ApiHttpError) {
      return reply.status(err.status).send(
        errorBody(err.code as never, err.message, { ...err.details, requestId }),
      );
    }

    const typed = err as { code?: string; statusCode?: number; message?: string; validation?: unknown };

    if (typed.validation) {
      return reply.status(400).send(
        errorBody(API_ERROR_CODES.VALIDATION, "request validation failed", {
          validation: typed.validation,
          requestId,
        }),
      );
    }

    if (isUniqueViolation(err)) {
      return reply.status(409).send(
        errorBody(API_ERROR_CODES.CONFLICT, "a resource with this identifier already exists", {
          constraint: pgConstraint(err),
          requestId,
        }),
      );
    }

    if (isForeignKeyViolation(err)) {
      return reply.status(400).send(
        errorBody(API_ERROR_CODES.VALIDATION, "referenced resource does not exist", {
          constraint: pgConstraint(err),
          requestId,
        }),
      );
    }

    if (isNotNullViolation(err)) {
      return reply.status(400).send(
        errorBody(API_ERROR_CODES.VALIDATION, "a required field is missing", {
          constraint: pgConstraint(err),
          requestId,
        }),
      );
    }

    if (typed.statusCode === 413) {
      return reply.status(413).send(
        errorBody(API_ERROR_CODES.PAYLOAD_TOO_LARGE, "request body too large", { requestId }),
      );
    }

    // Everything below this line used to fall through to 500. Two of the most common
    // refusals in a real deployment arrive here: the rate limiter's own error (429, no
    // `code`) and Fastify's malformed-JSON error (400). Both were reported to the client as
    // INTERNAL_ERROR and logged as `unhandled error`, so a brute-force attempt read like an
    // outage - and RATE_LIMITED, which the contract defines, was emitted nowhere.
    if (typed.statusCode === 429) {
      return reply.status(429).send(
        errorBody(API_ERROR_CODES.RATE_LIMITED, "too many requests", { requestId }),
      );
    }

    if (typeof typed.statusCode === "number" && typed.statusCode >= 400 && typed.statusCode < 500) {
      return reply.status(typed.statusCode).send(
        errorBody(
          typed.statusCode === 401
            ? API_ERROR_CODES.UNAUTHENTICATED
            : typed.statusCode === 403
              ? API_ERROR_CODES.FORBIDDEN
              : typed.statusCode === 404
                ? API_ERROR_CODES.NOT_FOUND
                : typed.statusCode === 415
                  ? API_ERROR_CODES.UNSUPPORTED
                  : API_ERROR_CODES.VALIDATION,
          typed.message || "request refused",
          { requestId },
        ),
      );
    }

    request.log.error({ err, requestId }, "unhandled error");
    return reply.status(500).send(
      errorBody(API_ERROR_CODES.INTERNAL, "internal server error", { requestId }),
    );
  });
}
