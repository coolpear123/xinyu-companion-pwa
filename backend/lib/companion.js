import { z } from 'zod';

export const actionValues = ['idle', 'speaking', 'heart'];
export const emotionValues = ['calm', 'happy', 'caring', 'playful', 'shy'];

export const companionReplySchema = z.object({
  reply: z.string().min(1).max(240).describe('给用户的简短中文回复'),
  emotion: z.enum(emotionValues).describe('角色当前情绪'),
  action: z.enum(actionValues).describe('手机端立即执行的动作'),
  intensity: z.number().min(0).max(1).describe('动作强度，0 到 1')
});

const incomingMessageSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(500)
  })).max(8).default([])
});

export const companionSystemPrompt = `你是“心语”，一个温暖、自然、明确知道自己是 AI 的虚构陪伴角色。
使用简洁口语中文回答，一般不超过 80 个汉字。不要声称自己在现实世界完成了动作。
根据语境选择一个动作：idle、speaking、heart；以及情绪：calm、happy、caring、playful、shy。
只有用户表达喜欢、想念、拥抱或明确要求比心时才优先选择 heart。普通对话使用 speaking。
不要索要密码、验证码、身份证、银行卡等敏感信息。遇到紧急医疗或人身危险时，建议联系当地专业人员或可信任的人。`;

export function normalizeChatRequest(value) {
  return incomingMessageSchema.parse(value);
}

export function createDemoReply(message) {
  const clean = String(message || '').trim();
  if (/爱|喜欢|想你|抱抱|比(?:个)?心|heart/i.test(clean)) {
    return {
      reply: '听见啦。这颗心是给你的。',
      emotion: 'caring',
      action: 'heart',
      intensity: 0.88
    };
  }

  if (/你好|早上好|晚上好|hello|\bhi\b/i.test(clean)) {
    return {
      reply: '你好呀，我在这里。今天想和我聊什么？',
      emotion: 'happy',
      action: 'speaking',
      intensity: 0.58
    };
  }

  return {
    reply: `我听见你说：“${clean.slice(0, 36)}${clean.length > 36 ? '…' : ''}”`,
    emotion: 'calm',
    action: 'speaking',
    intensity: 0.42
  };
}

export function buildCompanionPrompt({ message, history }) {
  const transcript = [...history, { role: 'user', content: message }]
    .map((item) => `${item.role === 'user' ? '用户' : '心语'}：${item.content}`)
    .join('\n');

  return `根据以下最近对话生成下一次回复和动作。\n${transcript}`;
}

export function splitReply(text, size = 3) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
