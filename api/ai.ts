import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { AiError } from '../server/openai.js';
import { handleLiveAi } from '../server/liveAi.js';

export default async function handler(req:VercelRequest,res:VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed.'});
  try { return res.status(200).json(await handleLiveAi(req.body,req.headers.authorization)); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({error:'Invalid request.'});
    if (error instanceof AiError) return res.status(error.status).json({error:error.message});
    console.error(error); return res.status(500).json({error:'Unexpected server error.'});
  }
}
