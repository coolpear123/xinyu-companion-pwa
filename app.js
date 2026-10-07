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

function replyTo(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage) return;

  const wantsHeart = /爱|喜欢|想你|比(?:个)?心|抱抱|heart/i.test(cleanMessage);
  if (wantsHeart) {
    setState('heart', '听见啦。这颗心是给你的。');
    return;
  }

  const reply = /你好|hello|hi/i.test(cleanMessage)
    ? '你好呀，我已经准备好陪你聊天了。'
    : `我听见你说：“${cleanMessage.slice(0, 24)}${cleanMessage.length > 24 ? '…' : ''}”`;
  setState('speaking', reply);
  speak(reply);
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
      replyTo(transcript);
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
  replyTo(message);
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
