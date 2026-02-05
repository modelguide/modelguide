/**
 * Tests for RBAC utilities
 */

import { describe, expect, test } from "bun:test";
import {
  type Permission,
  Permissions,
  getPermissionsForRole,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from "@lib/middleware/rbac";

describe("hasPermission", () => {
  test("admin has all permissions", () => {
    const allPermissions = Object.keys(Permissions) as Permission[];
    for (const permission of allPermissions) {
      expect(hasPermission("admin", permission)).toBe(true);
    }
  });

  test("support has read permissions", () => {
    expect(hasPermission("support", "agents:read")).toBe(true);
    expect(hasPermission("support", "connectors:read")).toBe(true);
    expect(hasPermission("support", "sessions:read")).toBe(true);
    expect(hasPermission("support", "analytics:read")).toBe(true);
  });

  test("support lacks create/delete permissions", () => {
    expect(hasPermission("support", "agents:create")).toBe(false);
    expect(hasPermission("support", "agents:delete")).toBe(false);
    expect(hasPermission("support", "users:create")).toBe(false);
    expect(hasPermission("support", "secrets:read")).toBe(false);
  });

  test("support can update sessions", () => {
    expect(hasPermission("support", "sessions:update")).toBe(true);
  });

  test("support can create and read feedback", () => {
    expect(hasPermission("support", "feedback:read")).toBe(true);
    expect(hasPermission("support", "feedback:create")).toBe(true);
  });
});

describe("hasAllPermissions", () => {
  test("returns true when role has all permissions", () => {
    expect(
      hasAllPermissions("admin", [
        "agents:read",
        "agents:create",
        "agents:delete",
      ]),
    ).toBe(true);
  });

  test("returns false when missing any permission", () => {
    expect(hasAllPermissions("support", ["agents:read", "agents:create"])).toBe(
      false,
    );
  });

  test("returns true for empty permissions array", () => {
    expect(hasAllPermissions("support", [])).toBe(true);
  });
});

describe("hasAnyPermission", () => {
  test("returns true when role has at least one permission", () => {
    expect(hasAnyPermission("support", ["agents:create", "agents:read"])).toBe(
      true,
    );
  });

  test("returns false when role has none of the permissions", () => {
    expect(
      hasAnyPermission("support", ["agents:create", "agents:delete"]),
    ).toBe(false);
  });

  test("returns false for empty permissions array", () => {
    expect(hasAnyPermission("support", [])).toBe(false);
  });
});

describe("getPermissionsForRole", () => {
  test("returns all permissions for admin", () => {
    const adminPermissions = getPermissionsForRole("admin");
    const allPermissions = Object.keys(Permissions) as Permission[];
    expect(adminPermissions.sort()).toEqual(allPermissions.sort());
  });

  test("returns subset of permissions for support", () => {
    const supportPermissions = getPermissionsForRole("support");
    const adminPermissions = getPermissionsForRole("admin");

    // Support should have fewer permissions than admin
    expect(supportPermissions.length).toBeLessThan(adminPermissions.length);

    // All support permissions should also be admin permissions
    for (const permission of supportPermissions) {
      expect(adminPermissions).toContain(permission);
    }
  });

  test("support permissions include expected read access", () => {
    const supportPermissions = getPermissionsForRole("support");
    expect(supportPermissions).toContain("agents:read");
    expect(supportPermissions).toContain("sessions:read");
    expect(supportPermissions).toContain("feedback:read");
  });

  test("support permissions exclude admin-only actions", () => {
    const supportPermissions = getPermissionsForRole("support");
    expect(supportPermissions).not.toContain("users:create");
    expect(supportPermissions).not.toContain("agents:delete");
    expect(supportPermissions).not.toContain("secrets:read");
  });
});

describe("Permissions constant", () => {
  test("all permissions have at least one role", () => {
    for (const [_permission, roles] of Object.entries(Permissions)) {
      expect(roles.length).toBeGreaterThan(0);
    }
  });

  test("admin is in all permission role arrays", () => {
    for (const [_permission, roles] of Object.entries(Permissions)) {
      expect(roles).toContain("admin");
    }
  });
});
