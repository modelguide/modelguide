# ADR-006: Structured Logging with Pino

**Status:** Accepted

## Context

As the API grows in features and traffic, production observability requires structured, machine-parseable logs with request correlation and sensitive data protection. References issue #63.

## Decision

### Pino as the logging library

Pino for its low-overhead async I/O and first-class Bun compatibility. JSON output in production, `pino-pretty` transport in development for readability.

### Core principles

1. **Request-scoped context** — every log line within a request carries a `requestId` (from `X-Request-Id` header or generated UUID). A `requestId()` middleware creates a Pino child logger stored in Hono context. `getLogger()` retrieves the scoped logger inside requests, falls back to the root logger outside (startup, tests, cron).

2. **Redaction as safety net** — Pino's `redact` option censors common sensitive paths (`authorization`, `cookie`, `token`, `apiKey`, `password`, `encryptedValue`). Services handling secrets must still use `mask()` explicitly — redact is the last line of defense.

3. **Async buffered I/O** — `pino.destination({ sync: false })` in production avoids blocking the event loop on log writes.

4. **Configurable verbosity** — `LOG_LEVEL` env var (default `info`) controls log level without code changes or redeployment.

5. **DRY instrumentation** — `withTiming()` wraps async operations with `performance.now()` timing, logging duration on both success and failure. One helper replaces ad-hoc timing patterns.

6. **Request lifecycle logging** — the request ID middleware logs `request started` and `request completed` with method, path, status, and duration for baseline observability.

7. **JSON by default, pretty-print in dev** — the canonical log format is newline-delimited JSON (`{ level, service, requestId, ... }`), suitable for log aggregators. In development (`NODE_ENV=development`), the `pino-pretty` transport renders colored, human-readable output automatically — no config needed. Production always emits raw JSON.

## Alternatives Considered

- **Winston** — heavier, slower in benchmarks, less idiomatic for Bun/Node streaming.
- **Bunyan** — largely unmaintained; Pino is its spiritual successor with better performance.
- **OpenTelemetry logging SDK** — too heavyweight for current needs; can be added later as a Pino transport.

## Consequences

- All log output is structured JSON in production, parseable by any log aggregator.
- Adding logging to a new feature requires only `getLogger()` — no boilerplate.
- Pino transports can forward logs to external systems (e.g., OTel collector) without changing application code.
