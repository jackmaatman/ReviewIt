(() => {
  const SOURCE = 'reviewit-drive-frame';
  let video = null;
  let frameId = 0;
  let playbackPrompt = null;
  let pendingPlaybackEvent = null;

  const log = (...args) => console.log('[ReviewIt] drive frame', ...args);
  const frameDetails = () => ({
    frameUrl: location.href,
    frameOrigin: location.origin,
    topLevel: window.top === window,
    videoCount: document.querySelectorAll('video').length
  });
  const mediaState = () => ({
    ...frameDetails(),
    hasVideo: Boolean(video),
    currentTime: video?.currentTime || 0,
    paused: video?.paused ?? true,
    duration: video?.duration || 0
  });

  function send(type, extra = {}) {
    window.top.postMessage({ source: SOURCE, type, ...extra }, '*');
  }

  function findVideo() {
    return [...document.querySelectorAll('video')]
      .find((candidate) => candidate.offsetWidth > 0 && candidate.offsetHeight > 0)
      || document.querySelector('video');
  }

  function removePlaybackPrompt() {
    playbackPrompt?.remove();
    playbackPrompt = null;
  }

  function expectedTime(event) {
    const elapsed = Math.max(0, (Date.now() - event.generatedAt) / 1000);
    return event.time + (event.playing ? elapsed : 0);
  }

  function showPlaybackPrompt(event) {
    pendingPlaybackEvent = event;
    if (playbackPrompt) return;

    const container = document.createElement('div');
    container.style.cssText = [
      'position: fixed',
      'z-index: 2147483647 !important',
      'left: 50%',
      'top: 50%',
      'transform: translate(-50%, -50%)',
      'isolation: isolate',
      'pointer-events: auto',
      'min-width: 214px',
      'padding: 16px',
      'background: rgba(23, 25, 29, 0.96)',
      'border: 1px solid rgba(255, 255, 255, 0.16)',
      'border-radius: 7px',
      'box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38)',
      'backdrop-filter: blur(10px)',
      'color: #f1f3f5',
      'font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'text-align: left'
    ].join(';');

    const brand = document.createElement('div');
    brand.style.cssText = 'color: #f5f6f7; font-size: 10px; font-weight: 700; letter-spacing: 0.14em;';
    const review = document.createElement('span');
    review.textContent = 'REVIEW';
    const it = document.createElement('span');
    it.textContent = 'IT';
    it.style.color = '#6fca9b';
    brand.append(review, it);
    const syncState = document.createElement('div');
    syncState.style.cssText = 'margin-top: 9px; color: #aeb5bf; font-size: 12px;';
    const syncDot = document.createElement('span');
    syncDot.textContent = '●';
    syncDot.style.color = '#6fca9b';
    const syncText = document.createElement('span');
    syncText.textContent = '  Synced to host';
    syncState.append(syncDot, syncText);
    const label = document.createElement('div');
    label.textContent = 'Click to join playback';
    label.style.cssText = 'margin-top: 14px; color: #858b95; font-size: 12px;';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Join Playback';
    button.style.cssText = [
      'width: 100%',
      'margin-top: 13px',
      'padding: 9px 13px',
      'border: 1px solid #3d78b8',
      'border-radius: 5px',
      'background: #2b6da8',
      'color: #fff',
      'font: inherit',
      'font-size: 13px',
      'font-weight: 600',
      'cursor: pointer',
      'position: relative',
      'z-index: 1',
      'pointer-events: auto'
    ].join(';');
    button.addEventListener('click', () => {
      const event = pendingPlaybackEvent;
      if (!video || !event) return;
      const targetTime = expectedTime(event);
      video.currentTime = Math.max(0, targetTime);
      log('iframe playback gesture', { targetTime, state: mediaState() });
      video.play().then(() => {
        log('iframe play succeeded after ReviewIt button click', mediaState());
        pendingPlaybackEvent = null;
        removePlaybackPrompt();
        send('DRIVE_PLAYBACK_ACTIVATED', { state: mediaState() });
      }).catch((error) => {
        log('iframe play rejected after ReviewIt button click', error);
      });
    });
    container.append(brand, syncState, label, button);
    (document.body || document.documentElement).append(container);
    playbackPrompt = container;
  }

  function restorePlaybackPrompt() {
    if (pendingPlaybackEvent && (!playbackPrompt || !document.documentElement.contains(playbackPrompt))) {
      playbackPrompt = null;
      showPlaybackPrompt(pendingPlaybackEvent);
    }
  }

  function attach() {
    const nextVideo = findVideo();
    if (!nextVideo || nextVideo === video) return;
    video = nextVideo;
    frameId += 1;
    log('player diagnostic', mediaState());
    send('DRIVE_PLAYER_READY', { frameId, state: mediaState() });
    video.addEventListener('play', () => send('DRIVE_PLAYER_EVENT', { event: 'play', state: mediaState() }));
    video.addEventListener('pause', () => send('DRIVE_PLAYER_EVENT', { event: 'pause', state: mediaState() }));
    video.addEventListener('seeking', () => send('DRIVE_PLAYER_EVENT', { event: 'seeking', state: mediaState() }));
    video.addEventListener('seeked', () => send('DRIVE_PLAYER_EVENT', { event: 'seeked', state: mediaState() }));
  }

  function sendDiagnostic() {
    const details = frameDetails();
    if (video) details.currentTime = video.currentTime;
    if (video) details.paused = video.paused;
    log('frame diagnostic', details);
    send('DRIVE_FRAME_DIAGNOSTIC', { state: { ...details, hasVideo: Boolean(video), currentTime: video?.currentTime || 0, paused: video?.paused ?? true } });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.top || event.data?.source !== 'reviewit-drive-controller') return;
    if (!video) {
      send('DRIVE_COMMAND_RESULT', { requestId: event.data.requestId, ok: false, error: 'No video element' });
      return;
    }

    const command = event.data.command;
    if (command === 'show-playback-prompt') {
      showPlaybackPrompt(event.data.event);
      return;
    }
    if (command === 'hide-playback-prompt') {
      pendingPlaybackEvent = null;
      removePlaybackPrompt();
      return;
    }
    try {
      let result;
      if (command === 'play') result = video.play();
      else if (command === 'pause') { video.pause(); result = undefined; }
      else if (command === 'seek') { video.currentTime = event.data.time; result = undefined; }
      else throw new Error(`Unknown command: ${command}`);
      Promise.resolve(result).then(() => {
        log(`${command} succeeded`, mediaState());
        send('DRIVE_COMMAND_RESULT', { requestId: event.data.requestId, ok: true, state: mediaState() });
      }).catch((error) => {
        log(`${command} rejected`, error);
        send('DRIVE_COMMAND_RESULT', { requestId: event.data.requestId, ok: false, error: error?.message || String(error), state: mediaState() });
      });
    } catch (error) {
      log(`${command} failed`, error);
      send('DRIVE_COMMAND_RESULT', { requestId: event.data.requestId, ok: false, error: error?.message || String(error), state: mediaState() });
    }
  });

  const observer = new MutationObserver(() => {
    attach();
    restorePlaybackPrompt();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    attach();
    restorePlaybackPrompt();
    if (video) sendDiagnostic();
  }, 1500);
  attach();
  sendDiagnostic();
})();
