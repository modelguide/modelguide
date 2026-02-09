# ADR-002: Magic Link Authentication & Session Lifecycle

## Status

Accepted (supersedes [ADR-001](./001-refresh-token-rotation.md) by incorporating it into a single reference)

## Context

ModelGuide is an internal admin/support dashboard — not a self-service product. User accounts are provisioned by the system (seed data or future admin invite flow), so there is no sign-up page. Traditional passwords add credential management burden (hashing, reset flows, breach exposure) with no real benefit for a small, provisioned user base.

## Decision

Implement passwordless authentication via magic links (one-time login URLs sent to the user's email).

### Full Auth Lifecycle

```
Browser                         API                            Email/Console
  │                              │                                │
  │  ┌─── LOGIN ─────────────────┤                                │
  │                              │                                │
  ├─ POST /auth/login {email} ──►│                                │
  │                              ├─ lookup user by email          │
  │                              │  (case-insensitive)            │
  │                              │                                │
  │                              │  [not found / inactive]        │
  │                              │  └─ log warning, return 200    │
  │                              │                                │
  │                              │  [found]                       │
  │                              ├─ generate token (43 chars)     │
  │                              ├─ store HMAC-SHA256 hash in DB  │
  │                              ├─ build link: APP_URL/auth/     │
  │                              │  verify?token=<token>          │
  │                              ├─ send via configured strategy ─►│
  │  ◄── 200 "Magic link sent" ─┤                                │
  │                              │                                │
  │  ┌─── VERIFY ────────────────┤                                │
  │                              │                                │
  │  (user clicks link)          │                                │
  ├─ GET /auth/verify?token= ──►│                                │
  │                              ├─ hash token, lookup in DB      │
  │                              ├─ check not used, not expired   │
  │                              ├─ atomic mark as used           │
  │                              ├─ create session in DB          │
  │                              │  (familyId, generation=0)      │
  │  ◄── access JWT (in-memory) ┤                                │
  │  ◄── refresh JWT (cookie)   ┤                                │
  │                              │                                │
  │  ┌─── REFRESH ───────────────┤                                │
  │                              │                                │
  │  (access JWT expired or      │                                │
  │   page reload)               │                                │
  ├─ POST /auth/refresh ────────►│                                │
  │  (cookie sent automatically) ├─ verify refresh JWT signature  │
  │                              ├─ CSRF: check Origin header     │
  │                              ├─ lookup familyId in DB         │
  │                              ├─ check expiresAt > now         │
  │                              ├─ atomic CAS: generation + 1    │
  │                              ├─ extend expiresAt (sliding)    │
  │  ◄── new access JWT         ┤                                │
  │  ◄── new refresh JWT cookie ┤                                │
  │                              │                                │
  │  ┌─── LOGOUT ────────────────┤                                │
  │                              │                                │
  ├─ POST /auth/logout ─────────►│                                │
  │                              ├─ CSRF: check Origin header     │
  │                              ├─ verify generation matches DB  │
  │                              ├─ delete session from DB        │
  │  ◄── clear cookie           ┤                                │
  │  UI clears in-memory state   │                                │
```

### Anti-Enumeration

`POST /auth/login` **always returns 200** regardless of whether the email exists. This prevents attackers from probing for valid accounts. When the user is not found or inactive, the service logs a warning server-side and returns early — no token is created, no email is sent.

### Session & Token Architecture

After a successful magic link verification, the API creates a session and issues two tokens:

| Token | Lifetime | Storage | Secret |
|-------|----------|---------|--------|
| Access JWT | 15 min (`JWT_EXPIRES_IN`) | Browser memory only (never persisted) | `JWT_SECRET` |
| Refresh JWT | 7 days sliding (`REFRESH_TOKEN_EXPIRES_IN`) | `__Host-refresh_token` httpOnly cookie | `REFRESH_JWT_SECRET` (separate key) |

**Why two secrets?** Separate keys eliminate token class confusion — a refresh JWT can never validate as an access JWT even if the `type` claim is stripped.

**Why no `exp` in refresh JWT?** Expiry is enforced by the DB `expiresAt` column only (single source of truth). Adding a JWT `exp` claim would create dual expiry sources. This is acceptable because we are web-only — no mobile or cross-origin clients.

### Refresh Cookie

`__Host-refresh_token`, `httpOnly: true`, `secure: true`, `sameSite: Strict`, `path: /`

The `__Host-` prefix enforces `Secure` + `Path=/` + no `Domain` at the browser level, preventing subdomain attacks. `SameSite=Strict` blocks cross-site cookie transmission. Chrome allows `Secure` cookies over `localhost` (dev exception); Firefox/Safari do not — **local dev requires Chrome**.

### CSRF Protection

Origin header validation (fail-closed) on `POST /auth/refresh` and `POST /auth/logout`:

1. Extract `Origin` header (fallback to `Referer` origin)
2. Both missing → reject `403 CSRF_REJECTED`
3. Origin !== `APP_URL` → reject `403 CSRF_REJECTED`

When using Vite proxy (UI `:3001` → API `:3000`), `APP_URL` must be set to the **frontend** URL (`http://localhost:3001`).

### Refresh Token Rotation & Reuse Detection

The `security_tokens` table stores one row per login session with a `generation` counter.

**Rotation:**
1. Verify refresh JWT signature (HS256 + `REFRESH_JWT_SECRET`)
2. Look up `familyId` in `security_tokens`
3. Check `expiresAt > now`
4. Atomic CAS: `UPDATE SET generation = generation + 1, expiresAt = now+7d WHERE familyId = ? AND generation = ?`
5. Issue new access + refresh JWTs

**Reuse detection:**
- `token.generation < db.generation - 1` → definite reuse → **revoke entire session**
- `token.generation === db.generation - 1` (gap of exactly 1) → benign race (another tab just rotated) → return 401, no revocation
- CAS miss (0 rows updated) → concurrent rotation won → return 401, no revocation

**Logout:** Requires the refresh token's generation to match DB. A stale token cannot force-logout the victim.

### UI Token Lifecycle

The UI handles token refresh transparently:

- **Page reload:** `_authenticated` route guard detects no in-memory token, calls `tryRefresh()` before rendering. Distinguishes auth errors (dead session → redirect to login) from network errors (offline → render with stale data, let ky interceptor retry later).
- **401 interceptor:** The `ky` HTTP client catches 401 responses, attempts a single refresh, and retries the original request with the new token. A `X-Retry-After-Refresh` header prevents infinite loops.
- **Tab visibility:** When a tab becomes visible after being idle, proactive refresh prevents the 401-retry-refresh cycle (throttled to 1 min).
- **Mid-session logout:** A reactive `useEffect` watches `isAuthenticated` and redirects to `/login` if it flips to `false` (e.g., after a failed refresh or manual logout). Clears the TanStack Query cache on the way out.

### Magic Link Token Security

| Property | Value |
|----------|-------|
| Token length | 43 characters (base64url, ~256 bits entropy) |
| Storage | HMAC-SHA256 hash only (raw token never stored) |
| HMAC key | `MAGIC_LINK_SECRET` env var (min 32 chars) |
| Expiry | Configurable via `MAGIC_LINK_EXPIRES_IN_MINUTES` (default 15) |
| Single-use | Atomic `UPDATE ... WHERE usedAt IS NULL` prevents race conditions |

The raw token appears only in the link (email/console). The database stores only the HMAC hash, so a database leak does not compromise pending tokens.

### Delivery Strategies

Controlled by `MAGIC_LINK_STRATEGY` env var:

| Strategy | Env value | Behavior |
|----------|-----------|----------|
| Console | `console` (default) | Prints the link to server stdout with colored box drawing for visibility |
| Resend | `resend` | Sends HTML email via [Resend](https://resend.com) API, logs the Resend email ID |

The sender is selected once at startup and cached for the process lifetime. Switching strategies requires a restart.

**Console strategy** is the default so `make api-dev` works with zero external dependencies — no email provider needed.

### Logging

The service logs every step so silent failures (like the email mismatch that motivated this ADR) are immediately visible:

```
[auth] Magic link requested for: user@example.com
[auth] No user found for user@example.com — returning 200 (anti-enumeration)
```

vs. happy path:

```
[auth] Magic link requested for: admin@pizza-palace.com
[auth] Magic link sent to admin@pizza-palace.com via console strategy
```

### Environment Variables

**Magic link:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAGIC_LINK_SECRET` | Yes | — | HMAC key for token hashing (min 32 chars) |
| `MAGIC_LINK_EXPIRES_IN_MINUTES` | No | `15` | Token validity window |
| `MAGIC_LINK_STRATEGY` | No | `console` | `console` or `resend` |
| `RESEND_API_KEY` | If resend | — | Resend API key |
| `RESEND_FROM_EMAIL` | If resend | — | Sender address for emails |
| `APP_URL` | No | `http://localhost:3000` | Base URL for magic link (must point to the **frontend** origin) |

**Session & tokens:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Access token signing key (min 32 chars) |
| `JWT_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `REFRESH_JWT_SECRET` | Yes | — | Refresh token signing key (must differ from `JWT_SECRET`) |
| `REFRESH_TOKEN_EXPIRES_IN` | No | `7d` | Refresh token sliding window |
| `REFRESH_SESSION_RETENTION_DAYS` | No | `90` | How long expired sessions are retained before cleanup |

### 401/403 Invariant

`401` is used exclusively for authentication failures. `403` for authorization/policy failures. The UI refresh interceptor triggers only on `401` — misusing it for authorization errors would cause refresh loops.

## Consequences

### Positive

- Zero password management — no hashing, no reset flow, no breach exposure
- Dev-friendly — console strategy works out of the box with no external services
- Secure by default — HMAC-hashed tokens, single-use, short-lived, anti-enumeration
- Transparent session renewal — users stay logged in for up to 7 days without re-authenticating
- Access token theft limited to 15-minute window
- Refresh token inaccessible to JavaScript (httpOnly cookie)
- Reuse detection provides stolen-token mitigation
- Observable — every login attempt is logged with outcome

### Negative

- Login requires email access (or server console in dev), slower than typing a password
- No offline login possible — requires email delivery or console visibility
- `APP_URL` must match the frontend origin, not the API listen address — a common misconfiguration source (see Logging section)
- DB lookup on every token rotation (acceptable for dashboard traffic patterns)
- `__Host-` cookies with `secure: true` only work over HTTP on Chrome; Firefox/Safari require HTTPS — local dev requires Chrome

### Risks

- If `MAGIC_LINK_SECRET` is rotated, all pending tokens become invalid
- If `REFRESH_JWT_SECRET` is rotated, all active sessions are invalidated (users must re-login via magic link)
- Console strategy logs sensitive URLs to stdout — ensure production never uses `console` strategy
- If mobile clients are added in the future, the cookie-based refresh transport won't work — would need a different mechanism
- Adding `exp` to refresh JWTs would create dual source of truth for expiry — **do not add it**
