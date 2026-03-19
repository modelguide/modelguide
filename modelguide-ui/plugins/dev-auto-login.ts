import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { SignJWT } from 'jose'
import postgres from 'postgres'
import type { Plugin } from 'vite'

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)
  const value = Number.parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 3600
    case 'd':
      return value * 86400
    default:
      throw new Error(`Unknown unit: ${unit}`)
  }
}

export function devAutoLogin(email: string): Plugin {
  const apiEnvPath = resolve(__dirname, '../../modelguide-api/.env')
  const apiEnv = parse(readFileSync(apiEnvPath))

  const databaseUrl = apiEnv.DATABASE_URL
  const jwtSecret = apiEnv.JWT_SECRET
  const refreshJwtSecret = apiEnv.REFRESH_JWT_SECRET
  const jwtExpiresIn = apiEnv.JWT_EXPIRES_IN || '15m'
  const refreshExpiresIn = apiEnv.REFRESH_TOKEN_EXPIRES_IN || '7d'

  if (!databaseUrl || !jwtSecret || !refreshJwtSecret) {
    throw new Error(
      'dev-auto-login: Missing DATABASE_URL, JWT_SECRET, or REFRESH_JWT_SECRET in modelguide-api/.env',
    )
  }

  async function generateTokens() {
    // databaseUrl is guaranteed non-null by validation above
    const sql = postgres(databaseUrl as string)
    try {
      await sql`SELECT set_config('app.bypass_rls', 'on', false)`
      const [user] = await sql`
        SELECT id, email, name, role, organization_id
        FROM users
        WHERE email = ${email} AND is_active = true
        LIMIT 1
      `
      if (!user) return null

      const refreshExpSeconds = parseDuration(refreshExpiresIn)
      const [session] = await sql`
        INSERT INTO security_tokens (user_id, generation, expires_at)
        VALUES (${user.id}, 0, NOW() + ${`${refreshExpSeconds} seconds`}::interval)
        RETURNING family_id
      `

      const accessExpSeconds = parseDuration(jwtExpiresIn)
      const now = Math.floor(Date.now() / 1000)
      const jwtSecretKey = new TextEncoder().encode(jwtSecret)
      const refreshSecretKey = new TextEncoder().encode(refreshJwtSecret)

      const accessToken = await new SignJWT({
        type: 'access',
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        org: user.organization_id,
        iat: now,
        exp: now + accessExpSeconds,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(jwtSecretKey)

      const refreshToken = await new SignJWT({
        type: 'refresh',
        fid: session.family_id,
        gen: 0,
        sub: user.id,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(refreshSecretKey)

      return {
        token: accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organization_id,
        },
      }
    } finally {
      await sql.end()
    }
  }

  return {
    name: 'dev-auto-login',
    apply: 'serve',

    configureServer(server) {
      // Serve /__dev-login as a self-contained HTML page that sets auth
      // state in localStorage and redirects to the app. The login page has
      // a useEffect that detects isAuthenticated after hydration and
      // navigates away client-side.
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__dev-login') return next()

        try {
          const result = await generateTokens()
          if (!result) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain')
            res.end(`[dev-auto-login] User not found: ${email}`)
            return
          }

          const storeData = JSON.stringify({
            state: { user: result.user, isAuthenticated: true },
            version: 0,
          })

          res.setHeader('Content-Type', 'text/html')
          // Set cookie so the /login middleware doesn't redirect again
          res.setHeader('Set-Cookie', '__dev-login-done=1; Path=/; Max-Age=86400')
          res.end(`<!DOCTYPE html>
<html><head><script>
localStorage.setItem('modelguide-auth', ${JSON.stringify(storeData)});
window.location.replace('/');
</script></head><body>Logging in…</body></html>`)
        } catch (err) {
          console.error('[dev-auto-login]', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain')
          res.end('[dev-auto-login] Failed')
        }
      })

      // Redirect /login to /__dev-login on first visit (before localStorage
      // is set). Once localStorage has auth state, the login page's useEffect
      // handles the redirect client-side.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/login')) return next()
        const cookies = req.headers.cookie || ''
        if (cookies.includes('__dev-login-done=1')) return next()
        res.writeHead(302, { Location: '/__dev-login' })
        res.end()
      })

      // Intercept POST /api/auth/refresh — on page reload the router sees
      // isAuthenticated=true but token=null, so it calls refreshAccessToken().
      // The real API refresh won't work over plain HTTP (__Host- cookie),
      // so we handle it here.
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/auth/refresh' || req.method !== 'POST') return next()

        try {
          const result = await generateTokens()
          if (!result) {
            res.statusCode = 401
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ token: result.token, user: result.user }))
        } catch (err) {
          console.error('[dev-auto-login] refresh failed:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Refresh failed' }))
        }
      })
    },
  }
}
