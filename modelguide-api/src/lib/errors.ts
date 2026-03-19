/**
 * Application error codes and error handling utilities
 */

// INVARIANT: 401 = authentication failures ONLY. Authorization/policy failures
// MUST use 403. The UI refresh interceptor triggers on 401 — misuse causes
// refresh loops.
export const ErrorCode = {
  // Authentication
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",

  // Refresh tokens
  REFRESH_TOKEN_INVALID: "REFRESH_TOKEN_INVALID",
  REFRESH_TOKEN_EXPIRED: "REFRESH_TOKEN_EXPIRED",
  REFRESH_TOKEN_REUSED: "REFRESH_TOKEN_REUSED",

  // CSRF
  CSRF_REJECTED: "CSRF_REJECTED",

  // Agent errors
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_INACTIVE: "AGENT_INACTIVE",
  AGENT_KEY_INVALID: "AGENT_KEY_INVALID",
  AGENT_KEY_EXPIRED: "AGENT_KEY_EXPIRED",

  // User errors
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_INACTIVE: "USER_INACTIVE",
  USER_EMAIL_EXISTS: "USER_EMAIL_EXISTS",

  // Organization errors
  ORGANIZATION_NOT_FOUND: "ORGANIZATION_NOT_FOUND",
  ORGANIZATION_REQUIRED: "ORGANIZATION_REQUIRED",

  // Resource errors
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  ALREADY_EXISTS: "ALREADY_EXISTS",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_INPUT: "INVALID_INPUT",

  // Magic link
  MAGIC_TOKEN_INVALID: "MAGIC_TOKEN_INVALID",
  MAGIC_TOKEN_EXPIRED: "MAGIC_TOKEN_EXPIRED",
  MAGIC_TOKEN_USED: "MAGIC_TOKEN_USED",

  // Connector errors
  CONNECTOR_NOT_FOUND: "CONNECTOR_NOT_FOUND",
  CONNECTOR_NOT_CONFIGURED: "CONNECTOR_NOT_CONFIGURED",
  CONNECTOR_INACTIVE: "CONNECTOR_INACTIVE",
  MISSING_SECRET_REF: "MISSING_SECRET_REF",

  // Tool errors
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_INACTIVE: "TOOL_INACTIVE",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",

  // Session errors
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_ALREADY_ENDED: "SESSION_ALREADY_ENDED",

  // SOP errors
  SOP_NOT_FOUND: "SOP_NOT_FOUND",
  SOP_TEMPLATE_NOT_FOUND: "SOP_TEMPLATE_NOT_FOUND",
  SOP_SLUG_EXISTS: "SOP_SLUG_EXISTS",
  SOP_INVALID_CONNECTOR_REF: "SOP_INVALID_CONNECTOR_REF",

  // Knowledge Base errors
  KNOWLEDGE_BASE_NOT_FOUND: "KNOWLEDGE_BASE_NOT_FOUND",
  KNOWLEDGE_BASE_SLUG_EXISTS: "KNOWLEDGE_BASE_SLUG_EXISTS",

  // Eval errors
  EVAL_RUN_NOT_FOUND: "EVAL_RUN_NOT_FOUND",
  EVAL_CONFIG_NOT_FOUND: "EVAL_CONFIG_NOT_FOUND",
  EVAL_SESSION_NOT_TERMINAL: "EVAL_SESSION_NOT_TERMINAL",
  EVAL_ALREADY_RUNNING: "EVAL_ALREADY_RUNNING",
  EVAL_CONFIG_IN_USE: "EVAL_CONFIG_IN_USE",
  EVAL_SUITE_NOT_FOUND: "EVAL_SUITE_NOT_FOUND",
  EVAL_SUITE_RUN_NOT_FOUND: "EVAL_SUITE_RUN_NOT_FOUND",

  // Server errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Maps error codes to HTTP status codes
 */
const statusCodeMap: Record<ErrorCode, number> = {
  // 401 Unauthorized
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.AGENT_KEY_INVALID]: 401,
  [ErrorCode.AGENT_KEY_EXPIRED]: 401,
  [ErrorCode.MAGIC_TOKEN_INVALID]: 401,
  [ErrorCode.MAGIC_TOKEN_EXPIRED]: 401,
  [ErrorCode.MAGIC_TOKEN_USED]: 401,

  // 401 Unauthorized (refresh tokens)
  [ErrorCode.REFRESH_TOKEN_INVALID]: 401,
  [ErrorCode.REFRESH_TOKEN_EXPIRED]: 401,
  [ErrorCode.REFRESH_TOKEN_REUSED]: 401,

  // 403 Forbidden
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CSRF_REJECTED]: 403,
  [ErrorCode.AGENT_INACTIVE]: 403,
  [ErrorCode.USER_INACTIVE]: 403,

  // 404 Not Found
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.AGENT_NOT_FOUND]: 404,
  [ErrorCode.USER_NOT_FOUND]: 404,
  [ErrorCode.ORGANIZATION_NOT_FOUND]: 404,
  [ErrorCode.CONNECTOR_NOT_FOUND]: 404,
  [ErrorCode.TOOL_NOT_FOUND]: 404,
  [ErrorCode.SESSION_NOT_FOUND]: 404,
  [ErrorCode.SOP_NOT_FOUND]: 404,
  [ErrorCode.SOP_TEMPLATE_NOT_FOUND]: 404,
  [ErrorCode.KNOWLEDGE_BASE_NOT_FOUND]: 404,
  [ErrorCode.EVAL_RUN_NOT_FOUND]: 404,
  [ErrorCode.EVAL_CONFIG_NOT_FOUND]: 404,
  [ErrorCode.EVAL_SUITE_NOT_FOUND]: 404,
  [ErrorCode.EVAL_SUITE_RUN_NOT_FOUND]: 404,

  // 409 Conflict
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.USER_EMAIL_EXISTS]: 409,
  [ErrorCode.SESSION_ALREADY_ENDED]: 409,
  [ErrorCode.SOP_SLUG_EXISTS]: 409,
  [ErrorCode.KNOWLEDGE_BASE_SLUG_EXISTS]: 409,
  [ErrorCode.EVAL_ALREADY_RUNNING]: 409,
  [ErrorCode.EVAL_CONFIG_IN_USE]: 409,

  // 400 Bad Request
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.ORGANIZATION_REQUIRED]: 400,
  [ErrorCode.CONNECTOR_NOT_CONFIGURED]: 400,
  [ErrorCode.CONNECTOR_INACTIVE]: 400,
  [ErrorCode.MISSING_SECRET_REF]: 400,
  [ErrorCode.TOOL_INACTIVE]: 400,
  [ErrorCode.SOP_INVALID_CONNECTOR_REF]: 400,
  [ErrorCode.EVAL_SESSION_NOT_TERMINAL]: 400,

  // 500 Internal Server Error
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.TOOL_EXECUTION_FAILED]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

/**
 * Custom application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusCodeMap[code] ?? 500;
    this.details = details;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Factory functions for common errors
 */
export const Errors = {
  // Authentication
  unauthorized(message = "Authentication required") {
    return new AppError(ErrorCode.UNAUTHORIZED, message);
  },

  forbidden(message = "Access denied") {
    return new AppError(ErrorCode.FORBIDDEN, message);
  },

  invalidToken(message = "Invalid authentication token") {
    return new AppError(ErrorCode.INVALID_TOKEN, message);
  },

  tokenExpired(message = "Authentication token has expired") {
    return new AppError(ErrorCode.TOKEN_EXPIRED, message);
  },

  // Generic
  notFound(resource: string, id?: string) {
    const message = id
      ? `${resource} not found: ${id}`
      : `${resource} not found`;
    return new AppError(ErrorCode.NOT_FOUND, message);
  },

  conflict(message: string) {
    return new AppError(ErrorCode.CONFLICT, message);
  },

  alreadyExists(resource: string, field?: string) {
    const message = field
      ? `${resource} with this ${field} already exists`
      : `${resource} already exists`;
    return new AppError(ErrorCode.ALREADY_EXISTS, message);
  },

  validationError(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
  },

  invalidInput(message: string, details?: Record<string, unknown>) {
    return new AppError(ErrorCode.INVALID_INPUT, message, details);
  },

  // Agent
  agentNotFound(id?: string) {
    return new AppError(
      ErrorCode.AGENT_NOT_FOUND,
      id ? `Agent not found: ${id}` : "Agent not found",
    );
  },

  agentInactive(id?: string) {
    return new AppError(
      ErrorCode.AGENT_INACTIVE,
      id ? `Agent is inactive: ${id}` : "Agent is inactive",
    );
  },

  agentKeyInvalid() {
    return new AppError(ErrorCode.AGENT_KEY_INVALID, "Invalid API key");
  },

  agentKeyExpired() {
    return new AppError(ErrorCode.AGENT_KEY_EXPIRED, "API key has expired");
  },

  // User
  userNotFound(id?: string) {
    return new AppError(
      ErrorCode.USER_NOT_FOUND,
      id ? `User not found: ${id}` : "User not found",
    );
  },

  userInactive() {
    return new AppError(ErrorCode.USER_INACTIVE, "User account is inactive");
  },

  userEmailExists(email: string) {
    return new AppError(
      ErrorCode.USER_EMAIL_EXISTS,
      `User with email ${email} already exists`,
    );
  },

  // Organization
  organizationNotFound(id?: string) {
    return new AppError(
      ErrorCode.ORGANIZATION_NOT_FOUND,
      id ? `Organization not found: ${id}` : "Organization not found",
    );
  },

  organizationRequired() {
    return new AppError(
      ErrorCode.ORGANIZATION_REQUIRED,
      "Organization context is required. Authenticate with a valid JWT or API key.",
    );
  },

  // Refresh token
  refreshTokenInvalid(message = "Invalid refresh token") {
    return new AppError(ErrorCode.REFRESH_TOKEN_INVALID, message);
  },

  refreshTokenExpired(message = "Refresh token has expired") {
    return new AppError(ErrorCode.REFRESH_TOKEN_EXPIRED, message);
  },

  refreshTokenReused(
    message = "Refresh token reuse detected — session revoked",
  ) {
    return new AppError(ErrorCode.REFRESH_TOKEN_REUSED, message);
  },

  csrfRejected(message = "CSRF validation failed") {
    return new AppError(ErrorCode.CSRF_REJECTED, message);
  },

  // Magic link
  magicTokenInvalid() {
    return new AppError(
      ErrorCode.MAGIC_TOKEN_INVALID,
      "Invalid magic link token",
    );
  },

  magicTokenExpired() {
    return new AppError(
      ErrorCode.MAGIC_TOKEN_EXPIRED,
      "Magic link has expired",
    );
  },

  magicTokenUsed() {
    return new AppError(
      ErrorCode.MAGIC_TOKEN_USED,
      "Magic link has already been used",
    );
  },

  // Connector
  connectorNotFound(id?: string) {
    return new AppError(
      ErrorCode.CONNECTOR_NOT_FOUND,
      id ? `Connector not found: ${id}` : "Connector not found",
    );
  },

  connectorNotConfigured(id?: string, details?: Record<string, unknown>) {
    return new AppError(
      ErrorCode.CONNECTOR_NOT_CONFIGURED,
      id ? `Connector not configured: ${id}` : "Connector is not configured",
      details,
    );
  },

  connectorInactive(id?: string) {
    return new AppError(
      ErrorCode.CONNECTOR_INACTIVE,
      id ? `Connector is inactive: ${id}` : "Connector is inactive",
    );
  },

  missingSecretRef(
    fieldName: string,
    entityType: "connector" | "agent",
    entityId: string,
  ) {
    return new AppError(
      ErrorCode.MISSING_SECRET_REF,
      `Secret reference for field "${fieldName}" not found in org vault (${entityType}: ${entityId})`,
    );
  },

  // Tool
  toolNotFound(name?: string) {
    return new AppError(
      ErrorCode.TOOL_NOT_FOUND,
      name ? `Tool not found: ${name}` : "Tool not found",
    );
  },

  toolInactive(name?: string) {
    return new AppError(
      ErrorCode.TOOL_INACTIVE,
      name ? `Tool is inactive: ${name}` : "Tool is inactive",
    );
  },

  toolExecutionFailed(name: string, reason?: string) {
    return new AppError(
      ErrorCode.TOOL_EXECUTION_FAILED,
      reason
        ? `Tool execution failed (${name}): ${reason}`
        : `Tool execution failed: ${name}`,
    );
  },

  // Session
  sessionNotFound(id?: string) {
    return new AppError(
      ErrorCode.SESSION_NOT_FOUND,
      id ? `Session not found: ${id}` : "Session not found",
    );
  },

  sessionAlreadyEnded(id?: string) {
    return new AppError(
      ErrorCode.SESSION_ALREADY_ENDED,
      id ? `Session already ended: ${id}` : "Session has already ended",
    );
  },

  // SOP
  sopNotFound(id?: string) {
    return new AppError(
      ErrorCode.SOP_NOT_FOUND,
      id ? `SOP not found: ${id}` : "SOP not found",
    );
  },

  sopTemplateNotFound(id?: string) {
    return new AppError(
      ErrorCode.SOP_TEMPLATE_NOT_FOUND,
      id ? `SOP template not found: ${id}` : "SOP template not found",
    );
  },

  sopSlugExists(slug: string) {
    return new AppError(
      ErrorCode.SOP_SLUG_EXISTS,
      `SOP with slug "${slug}" already exists`,
    );
  },

  sopInvalidConnectorRef(message: string) {
    return new AppError(ErrorCode.SOP_INVALID_CONNECTOR_REF, message);
  },

  // Knowledge Base
  knowledgeBaseNotFound(id?: string) {
    return new AppError(
      ErrorCode.KNOWLEDGE_BASE_NOT_FOUND,
      id
        ? `Knowledge base item not found: ${id}`
        : "Knowledge base item not found",
    );
  },

  knowledgeBaseSlugExists(slug: string) {
    return new AppError(
      ErrorCode.KNOWLEDGE_BASE_SLUG_EXISTS,
      `Knowledge base item with slug "${slug}" already exists`,
    );
  },

  // Eval
  evalRunNotFound(id?: string) {
    return new AppError(
      ErrorCode.EVAL_RUN_NOT_FOUND,
      id ? `Eval run not found: ${id}` : "Eval run not found",
    );
  },

  evalConfigNotFound(id?: string) {
    return new AppError(
      ErrorCode.EVAL_CONFIG_NOT_FOUND,
      id ? `Eval config not found: ${id}` : "Eval config not found",
    );
  },

  evalSessionNotTerminal(sessionId: string, status: string) {
    return new AppError(
      ErrorCode.EVAL_SESSION_NOT_TERMINAL,
      `Session "${sessionId}" is in "${status}" status — evaluation requires a terminal session (completed or abandoned)`,
    );
  },

  evalAlreadyRunning(sessionId: string, sourceId: string) {
    return new AppError(
      ErrorCode.EVAL_ALREADY_RUNNING,
      `An evaluation is already running for session "${sessionId}" and source "${sourceId}"`,
    );
  },

  evalSuiteNotFound(id?: string) {
    return new AppError(
      ErrorCode.EVAL_SUITE_NOT_FOUND,
      id ? `Eval suite not found: ${id}` : "Eval suite not found",
    );
  },

  evalSuiteRunNotFound(id?: string) {
    return new AppError(
      ErrorCode.EVAL_SUITE_RUN_NOT_FOUND,
      id ? `Eval suite run not found: ${id}` : "Eval suite run not found",
    );
  },

  evalConfigInUse(
    configId: string,
    referenceCount: number,
    sopNames?: string[],
  ) {
    const sopDetail =
      sopNames && sopNames.length > 0
        ? `. Remove it from: ${sopNames.join(", ")}`
        : "";
    return new AppError(
      ErrorCode.EVAL_CONFIG_IN_USE,
      `Eval config "${configId}" is referenced by ${referenceCount} SOP step(s) and cannot be deleted${sopDetail}`,
    );
  },

  // Server
  internal(message = "Internal server error") {
    return new AppError(ErrorCode.INTERNAL_ERROR, message);
  },

  serviceUnavailable(message = "Service temporarily unavailable") {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, message);
  },
};

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Safely extract a message from an unknown thrown value.
 */
export function getErrorMessage(
  err: unknown,
  fallback = "Unknown error",
): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Log an unexpected error and throw an internal AppError.
 * Re-throws AppErrors as-is to preserve the original code/status.
 */
export function logAndThrow(
  log: { error: (obj: Record<string, unknown>, msg: string) => void },
  err: unknown,
  context: Record<string, unknown>,
  message: string,
): never {
  if (isAppError(err)) throw err;
  log.error({ err, ...context }, message);
  throw Errors.internal(getErrorMessage(err, message));
}
