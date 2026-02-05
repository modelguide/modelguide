-- ============================================================================
-- RLS Policy Setup Migration
-- Sets up Row-Level Security policies for multi-tenancy
-- ============================================================================

-- Tables with organization_id that need RLS:
-- users, connectors, connector_tools, secrets, agents, api_keys, sessions

-- ============================================================================
-- Enable FORCE RLS on all tenant tables
-- (ENABLE ROW LEVEL SECURITY is already set by Drizzle's .enableRLS())
-- ============================================================================

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE connectors FORCE ROW LEVEL SECURITY;
ALTER TABLE connector_tools FORCE ROW LEVEL SECURITY;
ALTER TABLE secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- Users table policies
-- ============================================================================

-- Tenant isolation: users can only see/modify data in their organization
CREATE POLICY tenant_isolation_policy ON users
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

-- Bypass RLS: for auth operations that need to look up users before org is known
CREATE POLICY bypass_rls_policy ON users
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- Connectors table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON connectors
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON connectors
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- Connector Tools table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON connector_tools
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON connector_tools
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- Secrets table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON secrets
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON secrets
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- Agents table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON agents
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON agents
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- API Keys table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON api_keys
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON api_keys
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

-- ============================================================================
-- Sessions table policies
-- ============================================================================

CREATE POLICY tenant_isolation_policy ON sessions
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON sessions
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');
