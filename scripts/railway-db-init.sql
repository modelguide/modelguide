-- Railway DB initialization: create the application role
-- Usage: psql $DATABASE_MIGRATION_URL -v app_password='<secure-password>' -f scripts/railway-db-init.sql

CREATE ROLE modelguide_app WITH LOGIN PASSWORD :'app_password' NOSUPERUSER;

GRANT CONNECT ON DATABASE railway TO modelguide_app;
GRANT USAGE ON SCHEMA public TO modelguide_app;

-- App role can SELECT, INSERT, UPDATE, DELETE but NOT create/alter tables
-- Tables are created by migrations running as postgres (superuser)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modelguide_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modelguide_app;

-- Grant same privileges on future tables (created by migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modelguide_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO modelguide_app;
