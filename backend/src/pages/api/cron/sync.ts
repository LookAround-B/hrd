import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'node:crypto';
import { syncAll } from '../../../lib/sync';

// Scheduled sync trigger for serverless hosting (Vercel Cron or an external scheduler).
// Requires `Authorization: Bearer $CRON_SECRET`; Vercel Cron sends this header automatically.
export const config = { maxDuration: 300 };

function authorised(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || '';
  const header = req.headers.authorization || '';
  if (secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const result = await syncAll();
    return res.status(result.failures ? 207 : 200).json(result);
  } catch {
    console.error('HRD scheduled sync failed');
    return res.status(500).json({ error: 'Scheduled sync failed. Check HRD sync diagnostics.' });
  }
}
