import { z } from 'zod';

export class AiError extends Error { constructor(message: string, public status = 502) { super(message); } }
type UserContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export async function openRouterJson<T extends z.ZodType>(name: string, schema: T, jsonSchema: object, system: string, user: UserContent, maxTokens = 900): Promise<z.infer<T>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiError('OpenRouter is not configured. Add OPENROUTER_API_KEY to the server environment.', 503);
  const response = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173', 'X-Title': 'ReStock by Ledger' },
    body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini', temperature: 0,
      max_tokens: maxTokens, provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  }).catch(() => { throw new AiError('OpenRouter could not be reached. Please try again.', 502); });
  if (!response.ok) {
    const text = await response.text();
    throw new AiError(response.status === 401 ? 'OpenRouter rejected the API key.' : `OpenRouter returned ${response.status}: ${text.slice(0, 180)}`, 502);
  }
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new AiError('OpenRouter returned an empty response.');
  try { return schema.parse(JSON.parse(content)); }
  catch { throw new AiError('OpenRouter returned an invalid structured response.'); }
}

// Text-only ledger agent. Keep the invoice and order extraction model separate so
// changing the assistant does not alter the image extraction workflow.
export async function openRouterAgentJson<T extends z.ZodType>(name: string, schema: T, jsonSchema: object, system: string, user: string, maxTokens = 2200): Promise<z.infer<T>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiError('OpenRouter is not configured. Add OPENROUTER_API_KEY to the server environment.', 503);
  const response = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173', 'X-Title': 'ReStock by Ledger' },
    body: JSON.stringify({ model: process.env.OPENROUTER_AGENT_MODEL || 'openai/gpt-5.4', reasoning: { effort: 'medium' },
      max_completion_tokens: maxTokens, provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  }).catch(() => { throw new AiError('OpenRouter could not be reached. Please try again.', 502); });
  if (!response.ok) {
    const body = await response.text();
    throw new AiError(response.status === 401 ? 'OpenRouter rejected the API key.' : `OpenRouter returned ${response.status}: ${body.slice(0, 180)}`, 502);
  }
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new AiError('OpenRouter returned an empty response.');
  try { return schema.parse(JSON.parse(content)); }
  catch { throw new AiError('OpenRouter returned an invalid structured response.'); }
}

export type AgentToolCall = { id:string; type:'function'; function:{name:string; arguments:string} };
export type AgentMessage = {role:'system'|'user'|'assistant'|'tool'; content?:string|null; tool_call_id?:string; tool_calls?:AgentToolCall[]};
export async function openRouterAgentTurn(messages:AgentMessage[], tools:object[], toolChoice:'required'|'auto'|'none' = 'auto') {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiError('OpenRouter is not configured.',503);
  const response = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',signal:AbortSignal.timeout(50000),
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':process.env.APP_URL || 'http://localhost:5173','X-Title':'ReStock by Ledger'},
    body:JSON.stringify({model:process.env.OPENROUTER_AGENT_MODEL || 'openai/gpt-5.4',reasoning:{effort:'medium'},
      max_completion_tokens:1800,provider:{require_parameters:true},parallel_tool_calls:false,
      tools,tool_choice:toolChoice,messages})
  }).catch(() => { throw new AiError('OpenRouter could not be reached. Please try again.',502); });
  if (!response.ok) {
    const body = await response.text();
    throw new AiError(response.status === 401 ? 'OpenRouter rejected the API key.' : `OpenRouter returned ${response.status}: ${body.slice(0,180)}`,502);
  }
  const body = await response.json() as {choices?:{message?:AgentMessage}[]};
  const message = body.choices?.[0]?.message;
  if (!message || (!message.content && !message.tool_calls?.length)) throw new AiError('OpenRouter returned an empty assistant turn.');
  return message;
}
