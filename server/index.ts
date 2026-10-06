import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AiError } from './openrouter.js';
import { handleLiveAi } from './liveAi.js';
import { fetchRetailReferences } from './singstat.js';
import { handleWhatsappPreview } from './whatsappPreview.js';

const app = Fastify({ logger: true, bodyLimit: 2_800_000 });
app.post('/api/ai', async req => handleLiveAi(req.body, req.headers.authorization));
app.post('/api/whatsapp-preview', async req => handleWhatsappPreview(req.body, req.headers.authorization));
app.get('/api/whatsapp-status', async () => ({ configured: Boolean(process.env.SUPABASE_URL &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  process.env.OPENROUTER_API_KEY &&
  process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN &&
  process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_SHARED_PHONE_NUMBER_ID &&
  process.env.WHATSAPP_GRAPH_VERSION && process.env.WHATSAPP_ORDER_TEMPLATE_NAME &&
  process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME) }));
app.get('/api/market', async () => ({ rows: await fetchRetailReferences() }));
app.get('/api/health', async () => ({ ok: true, dataMode: 'supabase', aiConfigured: Boolean(process.env.OPENROUTER_API_KEY) }));
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request.' });
  if (error instanceof AiError) return reply.status(error.status).send({ error: error.message });
  app.log.error(error);
  return reply.status(500).send({ error: 'Unexpected server error.' });
});
const staticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(staticRoot)) await app.register(fastifyStatic, { root: staticRoot, prefix: '/', wildcard: false });
app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') || !existsSync(staticRoot) ? reply.status(404).send({ error: 'Route not found.' }) : reply.sendFile('index.html'));
await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' });
