const app = document.querySelector('.app-shell');
const statusText = document.querySelector('.status-text');
const speechText = document.querySelector('.speech-text');
const actionButtons = [...document.querySelectorAll('[data-action]')];
const form = document.querySelector('.composer');
const input = document.querySelector('#message');
const installButton = document.querySelector('.install-button');
const toast = document.querySelector('.toast');

const stateCopy = {
  idle: {
    status: '正在陪着你',
    message: '晚上好。先试试让我说话，或者给你比个心。'
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
  const wantsHeart = /爱|喜欢|想你|比(?:个)?心|抱抱|heart/i.test(message);
  if (wantsHeart) {
    setState('heart', '听见啦。这颗心是给你的。');
    return;
  }

  const reply = /你好|hello|hi/i.test(message)
    ? '你好呀，我已经准备好陪你聊天了。'
    : `我听见你说：“${message.slice(0, 24)}${message.length > 24 ? '…' : ''}”`;
  setState('speaking', reply);
  speak(reply);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    showToast('请使用浏览器菜单中的“添加到主屏幕”。');
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
