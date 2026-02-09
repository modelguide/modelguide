# ADR-001: Refresh Token Rotation

## Status

Superseded by [ADR-002: Magic Link Authentication & Session Lifecycle](./002-magic-link-authentication.md)

## Context

The UI previously used a single long-lived JWT (default 24h) stored in localStorage. This posed two problems:

1. **Security**: Long-lived tokens in localStorage are vulnerable to XSS — a single script injection gives an attacker a valid session token for up to 24 hours.
2. **UX**: When the token expires, the user is abruptly logged out mid-work and must re-authenticate via magic link.

## Decision

Implement refresh token rotation with short-lived access tokens.

### Security Scope

**Web-only.** This API will never serve mobile or cross-origin clients. This enables maximum browser-level isolation via `__Host-` cookie prefix, `httpOnly`, `Secure`, and `SameSite=Strict`.

### Token Architecture

| Token | Lifetime | Storage | Secret |
|-------|----------|---------|--------|
| Access JWT | 15 min (configurable via `JWT_EXPIRES_IN`) | In-memory only (not persisted) | `JWT_SECRET` |
| Refresh JWT | 7 days sliding (configurable via `REFRESH_TOKEN_EXPIRES_IN`) | `__Host-refresh_token` httpOnly cookie | `REFRESH_JWT_SECRET` |

### Cookie Configuration

`__Host-refresh_token`, `httpOnly: true`, `secure: true`, `sameSite: Strict`, `path: /`

The `__Host-` prefix enforces `Secure` + `Path=/` + no `Domain` at the browser level, preventing subdomain attacks (e.g., XSS on `blog.yourdomain.com` cannot touch the session cookie). `SameSite=Strict` blocks all cross-site cookie transmission. `Secure=true` always (localhost is a secure context in modern browsers).

### CSRF Protection

Origin header validation middleware (fail-closed). Applied to `POST /auth/refresh` and `POST /auth/logout`:

1. Extract `Origin` header (fallback to `Referer` header's origin)
2. If **both missing** → reject 403 `CSRF_REJECTED` (fail-closed)
3. If origin !== `APP_URL` → reject 403 `CSRF_REJECTED`

`SameSite=Strict` is defense-in-depth, not primary protection.

### Secret Separation

Access tokens use `JWT_SECRET`. Refresh tokens use a **separate** `REFRESH_JWT_SECRET`. This eliminates token class confusion — a refresh JWT can never validate as an access JWT even if the `type` claim is stripped.

Both use explicit HS256 algorithm locking in `sign()` and `verify()` calls.

### Expiry Source of Truth

**CRITICAL DESIGN DECISION**: The refresh JWT has **no `exp` claim**. Expiry is enforced by the DB `expiresAt` column only (single source of truth).

**Tradeoff**: A stolen refresh JWT is cryptographically valid forever. Security relies entirely on:
- DB lookup + `expiresAt` check on every rotation
- Cookie isolation (`__Host-`, httpOnly, Strict, Secure)

This is acceptable ONLY because we are web-only with no mobile/cross-origin clients. **DO NOT** reintroduce `exp` in the refresh JWT — it creates a second source of truth and makes the system harder to reason about.

### Rotation & Reuse Detection

The `security_tokens` table stores one row per login session with a `generation` counter.

**Rotation flow:**
1. Verify refresh JWT signature (HS256 + `REFRESH_JWT_SECRET`)
2. Look up `familyId` in `security_tokens`
3. Check `expiresAt > now`
4. Atomic CAS: `UPDATE SET generation = generation + 1, expiresAt = now+7d WHERE familyId = ? AND generation = ?`
5. Issue new access + refresh JWTs

**Reuse detection:**
- `token.generation < db.generation - 1` → definite reuse → **revoke entire session**
- `token.generation === db.generation - 1` (gap of exactly 1) → benign race (another tab just rotated) → return 401 without revocation, log `REFRESH_IN_PROGRESS` internally

**CAS miss** (0 rows updated): concurrent rotation won → return generic 401, no revocation.

### Logout Generation Guard

Logout requires the refresh token's generation to match the DB generation. An attacker with a stale token cannot force-logout the victim.

### 401/403 Invariant

`401` is used exclusively for authentication failures. Authorization/policy failures use `403`. The UI refresh interceptor triggers on `401` — misusing `401` for authorization errors would cause refresh loops.

## Consequences

### Positive

- Access token theft is limited to 15 minutes of exposure
- Refresh token is inaccessible to JavaScript (httpOnly cookie)
- Transparent token renewal — users stay logged in for up to 7 days
- Reuse detection provides stolen-token mitigation
- No new dependencies required

### Negative

- First load after upgrade requires a one-time re-login (no cookie exists yet)
- Slightly more complex auth flow (refresh interceptor, promise lock)
- DB lookup on every token rotation (acceptable for dashboard traffic patterns)

### Risks

- If `exp` is added to refresh JWTs in the future, it creates dual source of truth for expiry
- If mobile clients are added, the cookie-based approach won't work — would need a different transport
