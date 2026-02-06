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
} from "./auth";

// RLS middleware
export {
  rlsMiddleware,
  setRLSContext,
  clearRLSContext,
  withRLSContext,
  getRLSContext,
} from "./rls";

// CSRF middleware
export { csrfProtection } from "./csrf";

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
