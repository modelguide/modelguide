-- ============================================================================
-- Organizations RLS Policy Setup
-- Adds Row-Level Security to organizations table for tenant isolation
-- ============================================================================

-- Enable and force RLS on organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- Tenant isolation: org can only see itself (id = app.organization_id)
CREATE POLICY tenant_isolation_policy ON organizations
  FOR ALL
  USING (id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

-- Bypass RLS: for operations that need access before org context is established
CREATE POLICY bypass_rls_policy ON organizations
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');
