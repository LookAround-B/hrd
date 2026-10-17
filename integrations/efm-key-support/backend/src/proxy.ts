// Single server-side auth chokepoint for /api/*.
//
// The ~100 pages/api handlers each verify the JWT and run their own
// fine-grained permission checks. This layer sits in front of all of them and
// guarantees two things those handlers historically did NOT enforce:
//
//   1. Approval — an authenticated but unapproved account cannot reach data
//      routes (previously gated only by the frontend PrivateRoute, so a raw
//      token hit every endpoint).
//   2. Revocation — a blocked employee's token stops working immediately,
//      not just on /api/auth/me.
//
// Runs on the Node runtime (Next 16) so it can verify the HS256 JWT and read
// Redis. Employee JWT checks retain their existing behavior; integration JWTs
// additionally validate their key and current account state in the database.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { isEmployeeBlocked } from '@/lib/cache'
import { corsHeadersFor } from '@/lib/cors'
import { findActiveIntegrationKey, isIntegrationRequestAllowed } from '@/lib/integrationKeys'

export const config = {
  matcher: ['/api/:path*'],
}

// Reachable WITHOUT a token: health probe, login/signup and the emailed-link flows.
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/google',
  '/api/auth/google-test',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/integrations/token',
])

// Logged-in but NOT-yet-approved users may call these (PendingApprovalPage:
// read own profile, fill in details, upload an avatar).
const UNAPPROVED_ALLOWED = new Set([
  '/api/auth/me',
  '/api/auth/profile',
  '/api/employees/profile-update',
  '/api/upload',
])

// Baseline security headers on every API response.
const withSecurityHeaders = (res: NextResponse) => {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'no-referrer')
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return res
}

const next = () => withSecurityHeaders(NextResponse.next())
const json = (status: number, body: unknown) =>
  withSecurityHeaders(NextResponse.json(body, { status }))

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // CORS preflight is answered here, not forwarded to the route handler:
  // turbopack fails to resolve OPTIONS for handlers nested under a dynamic
  // folder segment (e.g. /api/lookups/[type]/*), 404-ing the preflight with no
  // CORS headers. Answering at the edge covers every /api/* route uniformly.
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, {
      status: 204,
      headers: corsHeadersFor(req.headers.get('origin') ?? undefined),
    })
    return withSecurityHeaders(res)
  }
  if (PUBLIC_PATHS.has(pathname)) return next()

  const authHeader = req.headers.get('authorization')
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  // The notification SSE stream is opened via EventSource, which cannot set an
  // Authorization header, so it passes the JWT as a query param. Accept it for
  // that one route only — every other check below (verify, revocation, approval)
  // still applies uniformly.
  if (!token && pathname === '/api/notifications/stream') {
    token = req.nextUrl.searchParams.get('token')
  }
  if (!token) return json(401, { error: 'Access token required' })

  const decoded = verifyToken(token)
  if (!decoded) return json(401, { error: 'Invalid or expired token' })

  if (decoded.integration !== undefined) {
    if (!isIntegrationRequestAllowed(req.method, pathname)) {
      return json(403, { error: 'Integration tokens only allow approved HRD reads' })
    }
    if (typeof decoded.integration?.keyId !== 'string' || !decoded.integration.keyId) {
      return json(401, { error: 'Invalid integration token' })
    }
    try {
      const key = await findActiveIntegrationKey({ id: decoded.integration.keyId })
      if (!key || key.employeeId !== decoded.id || key.employee.designation !== decoded.designation) {
        return json(401, { error: 'Integration credential revoked or account changed' })
      }
    } catch {
      return json(503, { error: 'Integration credential validation unavailable' })
    }
  }

  // Live revocation check.
  if (await isEmployeeBlocked(decoded.id)) {
    return json(401, { error: 'Session revoked', code: 'SESSION_REVOKED' })
  }

  // Approval gate. Only an explicit `false` is blocked: tokens minted before
  // the isApproved claim existed have it `undefined` and are let through to
  // avoid locking out current sessions on deploy. To enforce immediately for
  // everyone, rotate JWT_SECRET (invalidates all old tokens → forced re-login
  // → every new token carries the claim).
  if (decoded.isApproved === false && !UNAPPROVED_ALLOWED.has(pathname)) {
    return json(403, {
      error: 'Account pending administrator approval',
      code: 'NOT_APPROVED',
    })
  }

  return next()
}
