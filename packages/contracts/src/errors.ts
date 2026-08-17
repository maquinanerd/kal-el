import { apiErrorSchema } from "./common";

export const API_ERROR_CODES = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SITE_SCOPE_MISMATCH: "SITE_SCOPE_MISMATCH",
  RATE_LIMITED: "RATE_LIMITED",
  IDEMPOTENCY_REPLAY: "IDEMPOTENCY_REPLAY",
  INTERNAL: "INTERNAL_ERROR",
  UNSUPPORTED: "UNSUPPORTED_MEDIA_TYPE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
};

export function errorBody(code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

export const parseApiError = (body: unknown) => apiErrorSchema.safeParse(body);
