# Security Policy

## Reporting a Vulnerability

**Do not open a public issue.** Instead:

- **Email:** artur@modelguide.ai
- **GitHub:** [Report a vulnerability](https://github.com/modelguide/modelguide/security/advisories/new)

We aim to acknowledge within 48 hours. Please give us reasonable time to address issues before public disclosure.

## Security Model

ModelGuide handles encrypted credentials, auth tokens, and session transcripts. Key protections:

- **Auth:** Magic link login, short-lived JWTs (15 min, memory-only), refresh token rotation with reuse detection, CSRF via Origin validation
- **Agent keys:** SHA-256 hashed before storage, shown once at creation
- **Secrets:** AES-256-GCM encrypted at rest, keys stored separately
- **Isolation:** PostgreSQL Row-Level Security enforces org boundaries
- **RBAC:** Admin/support roles with granular permissions; agents restricted to MCP only

See [ADR-001](docs/decisions/001-refresh-token-rotation.md) and [ADR-002](docs/decisions/002-magic-link-authentication.md) for design details.

## Supported Versions

Pre-1.0 — security fixes land on `main`. Run the latest version.
