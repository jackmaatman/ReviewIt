const startButton = document.querySelector('#start');
const roomInput = document.querySelector('#room');
const joinButton = document.querySelector('#join');
const activePanel = document.querySelector('#active');
const copyButton = document.querySelector('#copy');
const stopButton = document.querySelector('#stop');
const leaveButton = document.querySelector('#leave');
const status = document.querySelector('#status');
const JOIN_BASE_URL = 'https://reviewit-zoba.onrender.com/join?room=';

function render(config) {
  const role = config?.role;
  const roomId = config?.roomId;
  const active = role === 'HOST' || role === 'FOLLOWER';
  const isHost = role === 'HOST';
  const isFollower = role === 'FOLLOWER';

  startButton.style.display = active ? 'none' : 'block';
  roomInput.style.display = active ? 'none' : 'block';
  joinButton.style.display = active ? 'none' : 'block';
  activePanel.style.display = active ? 'block' : 'none';
  copyButton.style.display = isHost ? 'block' : 'none';
  stopButton.style.display = isHost ? 'block' : 'none';
  leaveButton.style.display = isFollower ? 'block' : 'none';

  if (isHost && roomId) status.textContent = `Hosting room ${roomId}`;
  else if (isHost) status.textContent = 'Starting host room...';
  else if (isFollower && roomId) status.textContent = `Joined room ${roomId}`;
  else status.textContent = 'Not in a review';
}

function send(command, onResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) {
      onResponse?.();
      return;
    }
    chrome.tabs.sendMessage(tab.id, command, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Open a Box video page first.';
        return;
      }
      if (response?.message) status.textContent = response.message;
      onResponse?.();
    });
  });
}

startButton.addEventListener('click', () => send({ type: 'START_HOST' }));
joinButton.addEventListener('click', () => {
  const roomId = roomInput.value.trim().toUpperCase();
  if (roomId.length !== 4) {
    status.textContent = 'Enter a 4-character room code.';
    return;
  }
  send({ type: 'START_FOLLOWER', roomId });
});

copyButton.addEventListener('click', () => {
  chrome.storage.local.get('boxReviewConfig', ({ boxReviewConfig }) => {
    if (!boxReviewConfig?.roomId) return;
    const joinUrl = `${JOIN_BASE_URL}${encodeURIComponent(boxReviewConfig.roomId)}`;
    navigator.clipboard.writeText(joinUrl);
    status.textContent = 'Copied review link';
  });
});

stopButton.addEventListener('click', () => send({ type: 'STOP_REVIEW' }));
leaveButton.addEventListener('click', () => send({ type: 'STOP_REVIEW' }));

function renderStoredState() {
  chrome.storage.local.get('boxReviewConfig', ({ boxReviewConfig }) => render(boxReviewConfig));
}

renderStoredState();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.boxReviewConfig) render(changes.boxReviewConfig.newValue);
});