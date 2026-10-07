import { Output, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  buildCompanionPrompt,
  companionReplySchema,
  companionSystemPrompt,
  createDemoReply,
  normalizeChatRequest,
  splitReply
} from '../lib/companion.js';

const DEFAULT_ORIGINS = [
  'https://game.uben.com',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:4174',
  'http://localhost:4174'
];

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowed = allowedOrigins();
  if (origin && !allowed.includes(origin)) return false;

  response.setHeader('Access-Control-Allow-Origin', origin || allowed[0]);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return true;
}

async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body);

  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error('请求内容过大');
  }
  return raw ? JSON.parse(raw) : {};
}

function startEventStream(response, mode) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();
  writeEvent(response, 'meta', { mode });
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamDemo(response, message) {
  const result = createDemoReply(message);
  for (const delta of splitReply(result.reply)) {
    writeEvent(response, 'reply', { delta });
    await new Promise((resolve) => setTimeout(resolve, 28));
  }
  writeEvent(response, 'action', {
    emotion: result.emotion,
    action: result.action,
    intensity: result.intensity
  });
  writeEvent(response, 'done', {});
}

async function streamModel(response, chat) {
  let emittedReply = '';
  let streamError;
  const result = streamText({
    model: openai.responses(process.env.OPENAI_MODEL || 'gpt-6-luna'),
    system: companionSystemPrompt,
    prompt: buildCompanionPrompt(chat),
    maxOutputTokens: 250,
    output: Output.object({
      name: 'CompanionReply',
      description: '心语的中文回复、情绪和手机端动作',
      schema: companionReplySchema
    }),
    providerOptions: {
      openai: {
        reasoningEffort: 'none',
        reasoningSummary: null,
        store: false,
        strictJsonSchema: true
      }
    },
    onError({ error }) {
      streamError = error;
    }
  });

  for await (const partial of result.partialOutputStream) {
    const nextReply = partial?.reply || '';
    if (nextReply.startsWith(emittedReply) && nextReply.length > emittedReply.length) {
      writeEvent(response, 'reply', { delta: nextReply.slice(emittedReply.length) });
      emittedReply = nextReply;
    }
  }

  if (streamError) throw streamError;
  const final = await result.output;
  if (!final.reply.startsWith(emittedReply)) {
    writeEvent(response, 'replace', { text: final.reply });
  } else if (final.reply.length > emittedReply.length) {
    writeEvent(response, 'reply', { delta: final.reply.slice(emittedReply.length) });
  }
  writeEvent(response, 'action', {
    emotion: final.emotion,
    action: final.action,
    intensity: final.intensity
  });
  writeEvent(response, 'done', {});
}

export default async function handler(request, response) {
  if (!applyCors(request, response)) {
    response.statusCode = 403;
    return response.end(JSON.stringify({ error: '不允许的来源' }));
  }

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    return response.end();
  }
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Allow', 'POST, OPTIONS');
    return response.end(JSON.stringify({ error: '只支持 POST 请求' }));
  }

  let chat;
  try {
    chat = normalizeChatRequest(await readJson(request));
  } catch {
    response.statusCode = 400;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    return response.end(JSON.stringify({ error: '消息格式不正确' }));
  }

  const liveMode = Boolean(process.env.OPENAI_API_KEY);
  startEventStream(response, liveMode ? 'live' : 'demo');

  try {
    if (liveMode) {
      await streamModel(response, chat);
    } else {
      await streamDemo(response, chat.message);
    }
  } catch (error) {
    console.error('companion_generation_failed', error instanceof Error ? error.message : error);
    writeEvent(response, 'error', { message: '暂时没能连接到 AI，请稍后再试。' });
  } finally {
    response.end();
  }
}
