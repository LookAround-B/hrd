// Integration keys: long-lived, revocable credentials for trusted internal
// systems (e.g. HRD) that need to READ EFM data on a schedule.
//
// Flow:
//   1. A server administrator creates a key bound to an existing approved employee
//      account (ideally a dedicated "integration" account).
//   2. The integration POSTs the key to /api/integrations/token and receives a
//      short-lived JWT carrying an `integration` claim.
//   3. proxy.ts only lets `integration` tokens make GET requests to the routes
//      in INTEGRATION_READ_ROUTES — never writes, whatever the account's role.
//
// Only a SHA-256 hash of each key is stored. The plain key is shown once.
import { createHash, randomBytes } from 'crypto'
import { getRedisClient, getRedisKeyPrefix } from '@/lib/redis'
import prisma from '@/lib/prisma'

export const INTEGRATION_KEY_PREFIX = 'efm_live_'
export const INTEGRATION_TOKEN_TTL_SECONDS = 15 * 60

const REVOKED_PREFIX = `${getRedisKeyPrefix()}:revoked:integration`

// Reviewed read-only routes. A GET to any of these has no side effects.
// Keep in sync with HRD's backend/src/lib/efm.ts allow-list.
const READ_ROUTES = new Set([
  '/api/auth/me',
  '/api/employees',
  '/api/horses',
  '/api/horse-care-team',
  '/api/health-records',
  '/api/medicine-logs',
  '/api/feed-inventory',
  '/api/feed-inventory/consumption-report',
  '/api/groceries-inventory',
  '/api/integrations/horse-feed-plans',
  '/api/integrations/grocery-usage',
  '/api/integrations/manifest',
])
const READ_ROUTE_PATTERNS = [/^\/api\/employees\/[a-zA-Z0-9_-]{1,100}$/]

export const isIntegrationRequestAllowed = (method: string, pathname: string): boolean => {
  if (method !== 'GET') return false
  return READ_ROUTES.has(pathname) || READ_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
}

export const generateIntegrationKey = (): string =>
  `${INTEGRATION_KEY_PREFIX}${randomBytes(32).toString('base64url')}`

export const hashIntegrationKey = (key: string): string =>
  createHash('sha256').update(key).digest('hex')

// Display-safe identifier, e.g. "efm_live_Ab3d…".
export const integrationKeyDisplayPrefix = (key: string): string =>
  key.slice(0, INTEGRATION_KEY_PREFIX.length + 4)

export const isWellFormedIntegrationKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(INTEGRATION_KEY_PREFIX) && /^[A-Za-z0-9_-]{40,80}$/.test(key.slice(INTEGRATION_KEY_PREFIX.length))

// Check the database on every integration request; revocation fails closed
// even when Redis is unavailable. Existing account permissions still apply.
export const findActiveIntegrationKey = async (where: { id: string } | { keyHash: string }) => {
  const key = await prisma.efmIntegrationKey.findUnique({ where, include: { employee: { select: {
    id: true, email: true, designation: true, isApproved: true, employmentStatus: true,
  } } } })
  if (!key || key.revokedAt || !key.employee.isApproved || key.employee.employmentStatus !== 'Active') return null
  return key
}

// Immediate revocation of already-issued tokens when Redis is available.
// Without Redis, issued tokens expire within INTEGRATION_TOKEN_TTL_SECONDS.
export const markIntegrationKeyRevoked = async (keyId: string): Promise<void> => {
  const client = await getRedisClient()
  if (!client) return
  try {
    await client.set(`${REVOKED_PREFIX}:${keyId}`, '1', { EX: INTEGRATION_TOKEN_TTL_SECONDS })
  } catch (error) {
    console.error('[integration] Failed to mark key revoked:', error)
  }
}

export const isIntegrationKeyRevoked = async (keyId: string): Promise<boolean> => {
  const client = await getRedisClient()
  if (!client) return false
  try {
    return (await client.get(`${REVOKED_PREFIX}:${keyId}`)) !== null
  } catch (error) {
    console.error('[integration] Failed to check key revocation:', error)
    return false
  }
}
