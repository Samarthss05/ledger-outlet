import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AiError } from './openrouter.js';
import { handleLiveAi } from './liveAi.js';

const app = Fastify({ logger: true, bodyLimit: 16_384 });
app.post('/api/ai', async req => handleLiveAi(req.body, req.headers.authorization));
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
