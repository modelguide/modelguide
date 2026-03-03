/**
 * Middleware exports
 */

// Authentication middleware
export {
  authMiddleware,
  requireAuth,
  requireUser,
  requireAgent,
  requireOrganization,
  getCurrentUser,
  getCurrentAgent,
  getOrganizationId,
  verifyApiKey,
} from "./auth";

// Request ID + logger middleware
export { requestId } from "./request-id";

// CSRF middleware
export { csrfProtection } from "./csrf";

// Rate limiting middleware
export { rateLimit } from "./rate-limit";

// RBAC middleware
export {
  requirePermission,
  requireAnyPermission,
  requireAdmin,
  requireAdminOrSupport,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getPermissionsForRole,
  Permissions,
  type Permission,
} from "./rbac";
