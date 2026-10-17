import type { NextApiRequest, NextApiResponse } from 'next'
import { withAuth } from '@/lib/withAuth'
import { hasFeaturePermission } from '@/lib/permissions'
import prisma from '@/lib/prisma'

// Read recorded rows only; the ordinary tracker GET creates missing rows.
export default withAuth(async (req: NextApiRequest, res: NextApiResponse, user) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!(await hasFeaturePermission(user.designation, 'grocery_tracker.read', user.id))) {
    return res.status(403).json({ error: 'Grocery tracker access is not permitted' })
  }
  const skip = req.query.skip ?? '0', take = req.query.take ?? '500'
  if (typeof skip !== 'string' || !/^\d{1,5}$/.test(skip) || Number(skip) > 50000 ||
      typeof take !== 'string' || !/^\d{1,3}$/.test(take) || Number(take) < 1 || Number(take) > 500) {
    return res.status(400).json({ error: 'Invalid pagination' })
  }
  const where = { category: { not: 'NON-FOOD ITEMS' } }
  const [data, total] = await Promise.all([
    prisma.groceryTracker.findMany({ where, skip: Number(skip), take: Number(take), orderBy: [{ year: 'desc' }, { month: 'desc' }, { id: 'asc' }], select: {
      id: true, itemKey: true, itemName: true, category: true, unit: true, month: true, year: true,
      openingStock: true, purchaseStock: true, monthlyBalance: true, remarks: true,
      w1Received: true, w1Used: true, w2Received: true, w2Used: true,
      w3Received: true, w3Used: true, w4Received: true, w4Used: true,
    } }),
    prisma.groceryTracker.count({ where }),
  ])
  return res.status(200).json({ data, pagination: { total, skip: Number(skip), take: Number(take) } })
}, { methods: ['GET'] })
