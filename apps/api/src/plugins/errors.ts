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
export const forbidden = (message = "forbidden") =>
  new ApiHttpError(403, API_ERROR_CODES.FORBIDDEN, message);
export const unauthorized = (message = "unauthenticated") =>
  new ApiHttpError(401, API_ERROR_CODES.UNAUTHENTICATED, message);
export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiHttpError(400, API_ERROR_CODES.VALIDATION, message, details);

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

    if (typed.code === "23505") {
      return reply.status(409).send(
        errorBody(API_ERROR_CODES.CONFLICT, "a resource with this identifier already exists", {
          constraint: (err as { constraint?: string }).constraint,
          requestId,
        }),
      );
    }

    if (typed.code === "23503") {
      return reply.status(400).send(
        errorBody(API_ERROR_CODES.VALIDATION, "referenced resource does not exist", {
          constraint: (err as { constraint?: string }).constraint,
          requestId,
        }),
      );
    }

    if (typed.code === "23502") {
      return reply.status(400).send(
        errorBody(API_ERROR_CODES.VALIDATION, "a required field is missing", {
          constraint: (err as { constraint?: string }).constraint,
          requestId,
        }),
      );
    }

    if (typed.statusCode === 413) {
      return reply.status(413).send(
        errorBody(API_ERROR_CODES.PAYLOAD_TOO_LARGE, "request body too large", { requestId }),
      );
    }

    request.log.error({ err, requestId }, "unhandled error");
    return reply.status(500).send(
      errorBody(API_ERROR_CODES.INTERNAL, "internal server error", { requestId }),
    );
  });
}
