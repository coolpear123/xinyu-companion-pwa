const app = document.querySelector('.app-shell');
const talkButton = document.querySelector('.talk-button');
const toast = document.querySelector('.toast');
const portraitVideo = document.querySelector('.portrait-video');
const runtimeConfig = window.XINYU_CONFIG || {};
const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
const chatApiUrl = runtimeConfig.chatApiUrl || (isLocalPreview
  ? 'http://127.0.0.1:8787/api/chat'
  : '/api/chat');

let resetTimer;
let mediaStream;
let mediaRecorder;
let recognition;
let transcript = '';
let pressActive = false;
let replyInFlight = false;
let conversationHistory = [];

function ensurePortraitPlayback() {
  if (!portraitVideo) return Promise.resolve();
  portraitVideo.muted = true;
  portraitVideo.defaultMuted = true;
  portraitVideo.setAttribute('muted', '');
  portraitVideo.setAttribute('playsinline', '');
  return portraitVideo.play().catch(() => {
    portraitVideo.classList.remove('is-playing');
  });
}

function setState(nextState) {
  app.dataset.state = nextState;
  if (portraitVideo) {
    const playbackRates = { idle: 1, listening: 0.82, speaking: 1.22, heart: 1.08 };
    portraitVideo.playbackRate = playbackRates[nextState] || 1;
    if (portraitVideo.paused) ensurePortraitPlayback();
  }
  window.clearTimeout(resetTimer);
  if (nextState === 'heart') {
    resetTimer = window.setTimeout(() => setState('idle'), 2500);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function speak(message) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.96;
  utterance.pitch = 1.04;
  utterance.onend = () => {
    if (app.dataset.state === 'speaking') setState('idle');
  };
  window.speechSynthesis.speak(utterance);
}

function createLocalReply(message) {
  const wantsHeart = /爱|喜欢|想你|比(?:个)?心|抱抱|heart/i.test(message);
  return wantsHeart
    ? { reply: '听见啦。这颗心是给你的。', emotion: 'caring', action: 'heart', intensity: 0.88 }
    : { reply: '我在，慢慢说给我听。', emotion: 'calm', action: 'speaking', intensity: 0.42 };
}

function applyCompanionResponse(result) {
  const action = ['idle', 'speaking', 'heart'].includes(result.action) ? result.action : 'speaking';
  app.dataset.emotion = result.emotion || 'calm';
  app.style.setProperty('--action-intensity', String(result.intensity ?? 0.5));
  setState(action);
  speak(result.reply);
}

function parseEventBlock(block) {
  let event = 'message';
  const dataLines = [];
  block.split('\n').forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  });
  if (!dataLines.length) return null;
  return { event, data: JSON.parse(dataLines.join('\n')) };
}

async function readEventStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    blocks.forEach((block) => {
      const parsed = parseEventBlock(block.trim());
      if (parsed) onEvent(parsed.event, parsed.data);
    });
    if (done) break;
  }
  if (buffer.trim()) {
    const parsed = parseEventBlock(buffer.trim());
    if (parsed) onEvent(parsed.event, parsed.data);
  }
}

async function requestCompanionReply(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage || replyInFlight) return;
  replyInFlight = true;
  setState('speaking');

  let accumulatedReply = '';
  let actionResult = { emotion: 'calm', action: 'speaking', intensity: 0.5 };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: cleanMessage, history: conversationHistory.slice(-8) }),
      signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error(`聊天服务返回 ${response.status}`);

    await readEventStream(response, (event, data) => {
      if (event === 'reply') accumulatedReply += data.delta || '';
      if (event === 'replace') accumulatedReply = data.text || accumulatedReply;
      if (event === 'action') actionResult = { ...actionResult, ...data };
      if (event === 'error') throw new Error(data.message || '聊天生成失败');
    });
    if (!accumulatedReply) throw new Error('聊天服务没有返回文字');
  } catch {
    const fallback = createLocalReply(cleanMessage);
    accumulatedReply = fallback.reply;
    actionResult = fallback;
  } finally {
    window.clearTimeout(timeout);
    replyInFlight = false;
  }

  conversationHistory.push(
    { role: 'user', content: cleanMessage },
    { role: 'assistant', content: accumulatedReply }
  );
  conversationHistory = conversationHistory.slice(-8);
  applyCompanionResponse({ ...actionResult, reply: accumulatedReply });
}

function setTalkUI(recording) {
  talkButton.classList.toggle('is-recording', recording);
  talkButton.setAttribute('aria-label', recording ? '松开发送' : '按住说话');
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const instance = new SpeechRecognition();
  instance.lang = 'zh-CN';
  instance.interimResults = true;
  instance.continuous = false;
  instance.maxAlternatives = 1;
  instance.onresult = (event) => {
    transcript = [...event.results].map((result) => result[0].transcript).join('');
  };
  instance.onerror = () => {};
  return instance;
}

async function startTalking(event) {
  event.preventDefault();
  if (pressActive || replyInFlight) return;
  talkButton.setPointerCapture?.(event.pointerId);
  pressActive = true;
  transcript = '';

  if (!navigator.mediaDevices?.getUserMedia) {
    pressActive = false;
    showToast('当前浏览器不支持麦克风');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    if (!pressActive) {
      mediaStream.getTracks().forEach((track) => track.stop());
      return;
    }

    setTalkUI(true);
    setState('listening');
    if ('MediaRecorder' in window) {
      mediaRecorder = new MediaRecorder(mediaStream);
      mediaRecorder.start();
    }
    recognition = createRecognition();
    try { recognition?.start(); } catch {}
  } catch {
    pressActive = false;
    setTalkUI(false);
    setState('idle');
    showToast('请允许使用麦克风');
  }
}

function stopTalking(event) {
  event?.preventDefault();
  if (!pressActive) return;
  pressActive = false;
  setTalkUI(false);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  try { recognition?.stop(); } catch {}
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;

  window.setTimeout(() => {
    if (transcript.trim()) {
      requestCompanionReply(transcript);
    } else {
      setState('idle');
      showToast('没听清，再按住说一次');
    }
  }, 420);
}

talkButton.addEventListener('pointerdown', startTalking);
talkButton.addEventListener('pointerup', stopTalking);
talkButton.addEventListener('pointercancel', stopTalking);
talkButton.addEventListener('contextmenu', (event) => event.preventDefault());

portraitVideo?.addEventListener('playing', () => {
  portraitVideo.classList.add('is-playing');
});

portraitVideo?.addEventListener('error', () => {
  portraitVideo.classList.remove('is-playing');
});

portraitVideo?.addEventListener('canplay', ensurePortraitPlayback);

document.addEventListener('pointerdown', ensurePortraitPlayback, { passive: true });
window.addEventListener('pageshow', ensurePortraitPlayback);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && portraitVideo?.paused) ensurePortraitPlayback();
});

if ('serviceWorker' in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

setState('idle');
