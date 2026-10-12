import { z } from 'zod';

export class AiError extends Error { constructor(message: string, public status = 502) { super(message); } }
type UserContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export type AgentToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type AgentMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_call_id?: string; tool_calls?: AgentToolCall[] };

const endpoint = 'https://api.openai.com/v1/chat/completions';

async function completion(body: object, timeoutMs: number) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AiError('OpenAI is not configured. Add OPENAI_API_KEY to the server environment.', 503);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new AiError('OpenAI could not be reached. Please try again.', 502);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
    const detail = error.error?.message?.slice(0, 180);
    throw new AiError(response.status === 401 ? 'OpenAI rejected the API key.' : `OpenAI returned ${response.status}${detail ? `: ${detail}` : ''}`, 502);
  }
  return response.json() as Promise<{ choices?: { message?: AgentMessage }[] }>;
}

async function structuredJson<T extends z.ZodType>(
  name: string, schema: T, jsonSchema: object, system: string, user: UserContent,
  maxTokens: number, model: string, reasoningEffort: 'none' | 'low', timeoutMs: number
): Promise<z.infer<T>> {
  const body = await completion({
    model, reasoning_effort: reasoningEffort, max_completion_tokens: maxTokens,
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  }, timeoutMs);
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new AiError('OpenAI returned an empty response.');
  try { return schema.parse(JSON.parse(content)); }
  catch { throw new AiError('OpenAI returned an invalid structured response.'); }
}

export async function openAiJson<T extends z.ZodType>(name: string, schema: T, jsonSchema: object, system: string, user: UserContent, maxTokens = 900): Promise<z.infer<T>> {
  return structuredJson(name, schema, jsonSchema, system, user, maxTokens, process.env.OPENAI_MODEL || 'gpt-5.4-mini', 'none', 25000);
}

// Keep extraction and the ledger agent configurable independently.
export async function openAiAgentJson<T extends z.ZodType>(name: string, schema: T, jsonSchema: object, system: string, user: string, maxTokens = 2200): Promise<z.infer<T>> {
  return structuredJson(name, schema, jsonSchema, system, user, maxTokens, process.env.OPENAI_AGENT_MODEL || 'gpt-5.4-mini', 'low', 45000);
}

export async function openAiAgentTurn(messages: AgentMessage[], tools: object[], toolChoice: 'required' | 'auto' | 'none' = 'auto') {
  const body = await completion({
    model: process.env.OPENAI_AGENT_MODEL || 'gpt-5.4-mini', reasoning_effort: 'low',
    max_completion_tokens: 1800, parallel_tool_calls: false,
    tools, tool_choice: toolChoice, messages
  }, 50000);
  const message = body.choices?.[0]?.message;
  if (!message || (!message.content && !message.tool_calls?.length)) throw new AiError('OpenAI returned an empty assistant turn.');
  return message;
}
