import type { Env } from "@/env";

/**
 * User roles for platform access
 */
export type UserRole = "admin" | "support";

/**
 * Authenticated user information
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
}

/**
 * Agent types for AI agents
 */
export type AgentType = "voice";

/**
 * Authenticated agent information
 */
export interface AuthAgent {
  id: string;
  name: string;
  organizationId: string;
  agentType: AgentType;
  isActive: boolean;
}

/**
 * Authentication context representing the current authenticated entity
 */
export type AuthContext =
  | { type: "user"; user: AuthUser }
  | { type: "agent"; agent: AuthAgent }
  | { type: "none" };

/**
 * Hono app bindings with typed variables and environment
 */
export interface AppBindings {
  Variables: {
    /** Current authentication context */
    auth: AuthContext;
    /** Current organization ID (from header or auth) */
    organizationId: string | null;
  };
  Bindings: Env;
}
