import type { Env } from "@/env";
import type { Logger } from "pino";

/**
 * User roles for platform access
 */
export type UserRole = "admin" | "support" | "viewer";

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
 * Agent modalities
 */
export type Modality = "voice" | "text";

/**
 * Authenticated agent information
 */
export interface AuthAgent {
  id: string;
  name: string;
  organizationId: string;
  modality: Modality;
  isActive: boolean;
  metadata: Record<string, unknown>;
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
    /** Unique request identifier (from X-Request-Id header or generated) */
    requestId: string;
    /** Request-scoped logger with requestId context */
    logger: Logger;
  };
  Bindings: Env;
}
