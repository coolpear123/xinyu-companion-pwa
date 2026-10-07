import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompanionPrompt,
  companionReplySchema,
  createDemoReply,
  normalizeChatRequest,
  splitReply
} from '../lib/companion.js';

test('normalizes a bounded chat request', () => {
  const result = normalizeChatRequest({
    message: '  你好  ',
    history: [{ role: 'assistant', content: '我在。' }]
  });
  assert.equal(result.message, '你好');
  assert.equal(result.history.length, 1);
});

test('rejects empty messages', () => {
  assert.throws(() => normalizeChatRequest({ message: '   ' }));
});

test('demo reply uses heart action for affectionate messages', () => {
  const result = createDemoReply('我想你了，给我比个心');
  assert.equal(result.action, 'heart');
  assert.equal(companionReplySchema.safeParse(result).success, true);
});

test('builds a prompt containing bounded history and current message', () => {
  const prompt = buildCompanionPrompt({
    message: '今天好吗？',
    history: [{ role: 'assistant', content: '我在这里。' }]
  });
  assert.match(prompt, /心语：我在这里。/);
  assert.match(prompt, /用户：今天好吗？/);
});

test('splits streamed replies without losing text', () => {
  const text = '你好呀，我一直在。';
  assert.equal(splitReply(text, 2).join(''), text);
});
