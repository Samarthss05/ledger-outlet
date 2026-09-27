import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchRetailReferences } from '../server/singstat.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const rows = await fetchRetailReferences();
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ rows });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: 'Official retail price data is temporarily unavailable.' });
  }
}
