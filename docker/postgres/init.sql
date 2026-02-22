-- ============================================================================
-- Database Roles (local dev only)
-- ============================================================================
-- modelguide (superuser) - used for migrations, owns tables
-- modelguide_app - used by application, subject to RLS
--
-- In production, scripts/migrate.ts is the canonical role provisioner.
-- This file only runs on first `docker compose up` (postgres entrypoint).

CREATE ROLE modelguide_app WITH LOGIN PASSWORD 'modelguide_app' NOSUPERUSER;

-- Grant privileges to app role
GRANT CONNECT ON DATABASE modelguide TO modelguide_app;
GRANT USAGE ON SCHEMA public TO modelguide_app;

-- App role can SELECT, INSERT, UPDATE, DELETE but NOT create/alter tables
-- Tables are created by migrations running as modelguide (superuser)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modelguide_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modelguide_app;

-- Grant same privileges on future tables (created by migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE modelguide IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modelguide_app;
ALTER DEFAULT PRIVILEGES FOR ROLE modelguide IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO modelguide_app;
