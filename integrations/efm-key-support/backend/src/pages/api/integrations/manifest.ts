import type { NextApiRequest, NextApiResponse } from 'next'
import { withAuth } from '@/lib/withAuth'
import routes from '@/lib/integration-route-catalog.json'

export default withAuth(async (req: NextApiRequest, res: NextApiResponse, user) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({
    version: 1, readOnly: Boolean(user.integration), routes,
    rateLimits: { tokenExchange: { requests: 30, windowSeconds: 60 }, dataReads: null },
  })
}, { methods: ['GET'] })
