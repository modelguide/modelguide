# ADR-002: Magic Link Authentication & Session Lifecycle

## Status

Accepted — see also [ADR-001: Refresh Token Rotation](./001-refresh-token-rotation.md) for the session/token mechanics after login.

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

After a successful magic link verification, the API creates a session and issues an access JWT (in-memory) and a refresh JWT (`__Host-refresh_token` httpOnly cookie). See [ADR-001](./001-refresh-token-rotation.md) for full details on token architecture, cookie configuration, CSRF protection, rotation mechanics, reuse detection, and UI refresh lifecycle.

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
[auth] Magic link requested for: delivered+admin-glowbox@resend.dev
[auth] Magic link sent to delivered+admin-glowbox@resend.dev via console strategy
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAGIC_LINK_SECRET` | Yes | — | HMAC key for token hashing (min 32 chars) |
| `MAGIC_LINK_EXPIRES_IN_MINUTES` | No | `15` | Token validity window |
| `MAGIC_LINK_STRATEGY` | No | `console` | `console` or `resend` |
| `RESEND_API_KEY` | If resend | — | Resend API key |
| `RESEND_FROM_EMAIL` | If resend | — | Sender address for emails |
| `APP_URL` | No | `http://localhost:3000` | Base URL for magic link (must point to the **frontend** origin) |

Session & token env vars are documented in [ADR-001](./001-refresh-token-rotation.md#environment-variables).

## Consequences

### Positive

- Zero password management — no hashing, no reset flow, no breach exposure
- Dev-friendly — console strategy works out of the box with no external services
- Secure by default — HMAC-hashed tokens, single-use, short-lived, anti-enumeration
- Observable — every login attempt is logged with outcome

### Negative

- Login requires email access (or server console in dev), slower than typing a password
- No offline login possible — requires email delivery or console visibility
- `APP_URL` must match the frontend origin, not the API listen address — a common misconfiguration source (see Logging section)

### Risks

- If `MAGIC_LINK_SECRET` is rotated, all pending tokens become invalid
- Console strategy logs sensitive URLs to stdout — ensure production never uses `console` strategy

See [ADR-001](./001-refresh-token-rotation.md#consequences) for session/token-related consequences and risks.
