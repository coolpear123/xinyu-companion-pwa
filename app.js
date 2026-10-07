const app = document.querySelector('.app-shell');
const statusText = document.querySelector('.status-text');
const speechText = document.querySelector('.speech-text');
const actionButtons = [...document.querySelectorAll('[data-action]')];
const form = document.querySelector('.composer');
const input = document.querySelector('#message');
const installButton = document.querySelector('.install-button');
const installDialog = document.querySelector('.install-dialog');
const talkButton = document.querySelector('.talk-button');
const talkStrong = talkButton.querySelector('strong');
const talkSmall = talkButton.querySelector('small');
const micNote = document.querySelector('.mic-note');
const toast = document.querySelector('.toast');
const sendButton = document.querySelector('.send-button');
const runtimeConfig = window.XINYU_CONFIG || {};
const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
const chatApiUrl = runtimeConfig.chatApiUrl || (isLocalPreview
  ? 'http://127.0.0.1:8787/api/chat'
  : '/api/chat');

const stateCopy = {
  idle: {
    status: '正在陪着你',
    message: '晚上好。先试试让我说话，或者给你比个心。'
  },
  listening: {
    status: '正在听你说',
    message: '我在听，慢慢说。'
  },
  speaking: {
    status: '正在说话',
    message: '这是“说话”状态。下一步会把真实语音和口型接到这里。'
  },
  heart: {
    status: '给你一个比心',
    message: '收到啦，也送你一个小小的心。'
  }
};

let resetTimer;
let deferredInstallPrompt;
let mediaStream;
let mediaRecorder;
let recordingChunks = [];
let recognition;
let transcript = '';
let pressActive = false;
let replyInFlight = false;
let conversationHistory = [];

function setState(nextState, customMessage) {
  const copy = stateCopy[nextState] || stateCopy.idle;
  app.dataset.state = nextState;
  statusText.textContent = copy.status;
  speechText.textContent = customMessage || copy.message;
  actionButtons.forEach((button) => {
    const active = button.dataset.action === nextState;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  window.clearTimeout(resetTimer);
  if (nextState === 'heart') {
    resetTimer = window.setTimeout(() => setState('idle', '我就在这里。'), 2500);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function speak(message) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.96;
  utterance.pitch = 1.04;
  utterance.onend = () => {
    if (app.dataset.state === 'speaking') setState('idle', '我说完啦。');
  };
  window.speechSynthesis.speak(utterance);
}

function createLocalReply(message) {
  const cleanMessage = message.trim();
  const wantsHeart = /爱|喜欢|想你|比(?:个)?心|抱抱|heart/i.test(cleanMessage);
  if (wantsHeart) {
    return {
      reply: '听见啦。这颗心是给你的。',
      emotion: 'caring',
      action: 'heart',
      intensity: 0.88
    };
  }

  return {
    reply: /你好|hello|\bhi\b/i.test(cleanMessage)
      ? '你好呀，我在这里。今天想和我聊什么？'
      : `我听见你说：“${cleanMessage.slice(0, 36)}${cleanMessage.length > 36 ? '…' : ''}”`,
    emotion: 'calm',
    action: 'speaking',
    intensity: 0.42
  };
}

function applyCompanionResponse(result) {
  const supportedAction = ['idle', 'speaking', 'heart'].includes(result.action)
    ? result.action
    : 'speaking';
  app.dataset.emotion = result.emotion || 'calm';
  app.style.setProperty('--action-intensity', String(result.intensity ?? 0.5));
  setState(supportedAction, result.reply);
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
  input.disabled = true;
  sendButton.disabled = true;
  setState('speaking', '让我想一想…');
  statusText.textContent = '正在想怎么回答你';
  micNote.textContent = '正在连接独立聊天服务…';

  let accumulatedReply = '';
  let actionResult = { emotion: 'calm', action: 'speaking', intensity: 0.5 };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: cleanMessage,
        history: conversationHistory.slice(-8)
      }),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`聊天服务返回 ${response.status}`);
    }

    await readEventStream(response, (event, data) => {
      if (event === 'meta') {
        micNote.textContent = data.mode === 'live' ? 'AI 已连接' : '后端演示模式';
      } else if (event === 'reply') {
        accumulatedReply += data.delta || '';
        setState('speaking', accumulatedReply || '…');
      } else if (event === 'replace') {
        accumulatedReply = data.text || accumulatedReply;
        setState('speaking', accumulatedReply);
      } else if (event === 'action') {
        actionResult = { ...actionResult, ...data };
      } else if (event === 'error') {
        throw new Error(data.message || '聊天生成失败');
      }
    });

    if (!accumulatedReply) throw new Error('聊天服务没有返回文字');
  } catch (error) {
    const fallback = createLocalReply(cleanMessage);
    accumulatedReply = fallback.reply;
    actionResult = fallback;
    micNote.textContent = '离线演示模式 · 独立后端尚未上线';
  } finally {
    window.clearTimeout(timeout);
    replyInFlight = false;
    input.disabled = false;
    sendButton.disabled = false;
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
  talkStrong.textContent = recording ? '正在听…' : '按住说话';
  talkSmall.textContent = recording ? '松开发送' : '松开发送';
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
    if (transcript) micNote.textContent = transcript;
  };
  instance.onerror = () => {};
  return instance;
}

async function startTalking(event) {
  event.preventDefault();
  if (pressActive) return;
  talkButton.setPointerCapture?.(event.pointerId);
  pressActive = true;
  transcript = '';
  recordingChunks = [];

  if (!navigator.mediaDevices?.getUserMedia) {
    pressActive = false;
    showToast('当前浏览器不支持麦克风，请换用 Safari 或 Chrome。');
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
    setState('listening', '我在听，慢慢说。');
    statusText.textContent = '正在听你说';
    micNote.textContent = '正在录音…';

    if ('MediaRecorder' in window) {
      mediaRecorder = new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (chunk) => {
        if (chunk.data.size) recordingChunks.push(chunk.data);
      };
      mediaRecorder.start();
    }

    recognition = createRecognition();
    try { recognition?.start(); } catch {}
  } catch (error) {
    pressActive = false;
    setTalkUI(false);
    micNote.textContent = '未获得麦克风权限';
    setState('idle', '允许麦克风后，我才能听见你。');
    showToast('请在浏览器设置中允许此网站使用麦克风。');
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
      micNote.textContent = `你说：${transcript}`;
      requestCompanionReply(transcript);
    } else {
      micNote.textContent = recordingChunks.length ? '录音测试成功' : '语音识别暂不可用';
      setState('idle', recordingChunks.length
        ? '我已经收到你的声音。接通 AI 后端后，就能真正回答你。'
        : '这台手机暂时不能直接转成文字，可以先用下方输入框。');
    }
  }, 320);
}

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    window.speechSynthesis?.cancel();
    setState(action);
    if (action === 'speaking') speak(stateCopy.speaking.message);
  });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) {
    input.focus();
    return;
  }

  input.value = '';
  requestCompanionReply(message);
});

talkButton.addEventListener('pointerdown', startTalking);
talkButton.addEventListener('pointerup', stopTalking);
talkButton.addEventListener('pointercancel', stopTalking);
talkButton.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    installDialog.showModal();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  showToast('已安装到桌面。');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      showToast('离线缓存暂时不可用，但页面仍可正常使用。');
    });
  });
}

setState('idle');
