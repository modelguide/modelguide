/**
 * Role-Based Access Control (RBAC) middleware
 * Enforces permission checks based on user roles
 */

import type { AppBindings, UserRole } from "@/types";
import { Errors } from "@lib/errors";
import type { MiddlewareHandler } from "hono";

/**
 * Permission definitions
 * Maps user roles to their allowed permissions
 */
export const Permissions = {
  // User management
  "users:read": ["admin", "support", "viewer"],
  "users:create": ["admin"],
  "users:update": ["admin", "support"],
  "users:delete": ["admin"],

  // Agent management
  "agents:read": ["admin", "support", "viewer"],
  "agents:create": ["admin"],
  "agents:update": ["admin"],
  "agents:delete": ["admin"],
  "agents:activate": ["admin"],
  "agents:generate-key": ["admin"],

  // Connector management
  "connectors:read": ["admin", "support", "viewer"],
  "connectors:create": ["admin"],
  "connectors:update": ["admin"],
  "connectors:delete": ["admin"],

  // Tool management
  "tools:read": ["admin", "support", "viewer"],
  "tools:assign": ["admin"],
  "tools:unassign": ["admin"],

  // Secret management
  "secrets:read": ["admin"],
  "secrets:create": ["admin"],
  "secrets:update": ["admin"],
  "secrets:delete": ["admin"],

  // Session management
  "sessions:read": ["admin", "support", "viewer"],
  "sessions:update": ["support", "admin"],

  // Feedback management
  "feedback:read": ["admin", "support", "viewer"],
  "feedback:create": ["admin", "support"],
  "feedback:update": ["admin", "support"],

  // Analytics
  "analytics:read": ["admin", "support", "viewer"],

  // Organization management
  "organization:read": ["admin", "support", "viewer"],
  "organization:update": ["admin"],

  // SOP management
  "sops:read": ["admin", "support", "viewer"],
  "sops:create": ["admin"],
  "sops:update": ["admin", "support"],
  "sops:delete": ["admin"],

  // Knowledge Base management
  "knowledge_base:read": ["admin", "support", "viewer"],
  "knowledge_base:create": ["admin"],
  "knowledge_base:update": ["admin", "support"],
  "knowledge_base:delete": ["admin"],

  // Eval config management
  "eval_configs:read": ["admin", "support", "viewer"],
  "eval_configs:create": ["admin"],
  "eval_configs:update": ["admin"],
  "eval_configs:delete": ["admin"],

  // Eval run management
  "eval_runs:read": ["admin", "support", "viewer"],
  "eval_runs:create": ["admin", "support"],
} as const;

export type Permission = keyof typeof Permissions;

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowedRoles = Permissions[permission] as readonly string[];
  return allowedRoles.includes(role);
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(
  role: UserRole,
  permissions: Permission[],
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(
  role: UserRole,
  permissions: Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Middleware that requires specific permission(s)
 * All specified permissions must be satisfied (AND logic)
 */
export function requirePermission(
  ...permissions: Permission[]
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    // Must be authenticated as a user
    if (auth.type !== "user") {
      throw Errors.unauthorized("User authentication required");
    }

    const { role } = auth.user;

    // Check all permissions
    for (const permission of permissions) {
      if (!hasPermission(role, permission)) {
        throw Errors.forbidden(
          `Permission denied: ${permission} requires ${Permissions[permission].join(" or ")} role`,
        );
      }
    }

    await next();
  };
}

/**
 * Middleware that requires any of the specified permissions (OR logic)
 */
export function requireAnyPermission(
  ...permissions: Permission[]
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type !== "user") {
      throw Errors.unauthorized("User authentication required");
    }

    const { role } = auth.user;

    if (!hasAnyPermission(role, permissions)) {
      throw Errors.forbidden(
        `Permission denied: requires one of ${permissions.join(", ")}`,
      );
    }

    await next();
  };
}

/**
 * Middleware that requires admin role
 */
export function requireAdmin(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type !== "user") {
      throw Errors.unauthorized("User authentication required");
    }

    if (auth.user.role !== "admin") {
      throw Errors.forbidden("Admin access required");
    }

    await next();
  };
}

/**
 * Middleware that requires admin or support role
 */
export function requireAdminOrSupport(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type !== "user") {
      throw Errors.unauthorized("User authentication required");
    }

    if (auth.user.role !== "admin" && auth.user.role !== "support") {
      throw Errors.forbidden("Admin or support access required");
    }

    await next();
  };
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: UserRole): Permission[] {
  return (Object.keys(Permissions) as Permission[]).filter((permission) =>
    hasPermission(role, permission),
  );
}
