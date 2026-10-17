import type { NextApiRequest, NextApiResponse } from 'next'
import { withAuth } from '@/lib/withAuth'
import { getTaskCapabilitiesForUser } from '@/lib/auth'
import { hasFeaturePermission } from '@/lib/permissions'
import prisma from '@/lib/prisma'

// A dedicated read avoids /horse-feeds' notification-creation side effect.
export default withAuth(async (req: NextApiRequest, res: NextApiResponse, user) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const capabilities = await getTaskCapabilitiesForUser(user.id, user.designation)
  if (!(await hasFeaturePermission(user.designation, 'horse_feeds.view', user.id)) &&
      !capabilities.canViewHorseFeeds && !capabilities.canRecordHorseFeeds) {
    return res.status(403).json({ error: 'Horse feed access is not permitted' })
  }
  const skip = req.query.skip ?? '0', take = req.query.take ?? '500'
  if (typeof skip !== 'string' || !/^\d{1,5}$/.test(skip) || Number(skip) > 50000 ||
      typeof take !== 'string' || !/^\d{1,3}$/.test(take) || Number(take) < 1 || Number(take) > 500) {
    return res.status(400).json({ error: 'Invalid pagination' })
  }
  const [data, total] = await Promise.all([
    prisma.horseFeed.findMany({ skip: Number(skip), take: Number(take), orderBy: [{ date: 'desc' }, { id: 'asc' }], select: {
      id: true, horseId: true, date: true, notes: true,
      temporaryMenuName: true, menuStartAt: true, menuEndAt: true,
      sports: true, balance: true, growth: true, oats: true, barley: true,
      soya: true, linseed: true, bran: true, salt: true, dcp: true, epsom: true,
      riceBranOil: true, heylage: true, lucerne: true, electrolyte: true, diggyMax: true, coolMix: true,
      horse: { select: { id: true, name: true } },
    } }),
    prisma.horseFeed.count(),
  ])
  return res.status(200).json({ data, pagination: { total, skip: Number(skip), take: Number(take) } })
}, { methods: ['GET'] })
