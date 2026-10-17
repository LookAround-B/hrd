import type { NextApiRequest, NextApiResponse } from 'next'
import { generateIntegrationToken } from '@/lib/auth'
import { isEmployeeBlocked } from '@/lib/cache'
import { findActiveIntegrationKey, hashIntegrationKey, isWellFormedIntegrationKey, INTEGRATION_TOKEN_TTL_SECONDS } from '@/lib/integrationKeys'
import prisma from '@/lib/prisma'
import { rateLimit } from '@/lib/rateLimit'

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const limit = await rateLimit(req, { max: 30, windowSecs: 60, prefix: 'integration:token' })
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, limit.resetAt - Math.floor(Date.now() / 1000))))
      return res.status(429).json({ error: 'Too many token requests' })
    }
    const rawKey: unknown = req.body?.key
    if (!isWellFormedIntegrationKey(rawKey)) return res.status(401).json({ error: 'Invalid integration key' })
    const key = await findActiveIntegrationKey({ keyHash: hashIntegrationKey(rawKey) })
    if (!key || await isEmployeeBlocked(key.employeeId)) return res.status(401).json({ error: 'Invalid or revoked integration key' })
    const token = generateIntegrationToken({
      id: key.employeeId, email: key.employee.email,
      designation: key.employee.designation, isApproved: true,
      integration: { keyId: key.id },
    })
    await prisma.efmIntegrationKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    return res.status(200).json({ token, expiresIn: INTEGRATION_TOKEN_TTL_SECONDS })
  } catch {
    // Do not log request bodies, keys, issued tokens or database errors here.
    return res.status(503).json({ error: 'Integration token service unavailable' })
  }
}
