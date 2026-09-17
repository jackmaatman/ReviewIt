(() => {
  const RELAY_URL = 'wss://reviewit-zoba.onrender.com';
  const HEARTBEAT_MS = 1500;
  const DRIFT_TOLERANCE_SECONDS = 0.35;
  let config = null;
  let socket = null;
  let player = null;
  let lastUrl = location.href;
  let suppressPlayerEvents = false;
  let seeking = false;
  let pendingFollowerEvent = null;
  let hostNavigationPending = false;
  let reconnectEnabled = true;
  let playbackPrompt = null;

  const log = (...args) => console.log('[box-sync]', ...args);
  const message = (text) => ({ message: text });

  function saveConfig() {
    chrome.storage.local.set({ boxReviewConfig: config });
  }

  function currentEvent(type, extra = {}) {
    return {
      type,
      url: location.href,
      time: player?.currentTime || 0,
      playing: Boolean(player && !player.paused),
      generatedAt: Date.now(),
      ...extra
    };
  }

  function sendHostEvent(event) {
    if (config?.role !== 'HOST' || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'HOST_EVENT', event }));
  }

  function expectedTime(event) {
    const elapsed = Math.max(0, (Date.now() - event.generatedAt) / 1000);
    return event.time + (event.playing ? elapsed : 0);
  }

  function removePlaybackPrompt() {
    playbackPrompt?.remove();
    playbackPrompt = null;
  }

  function showPlaybackPrompt(event) {
    pendingFollowerEvent = event;
    if (playbackPrompt) return;

    const container = document.createElement('div');
    container.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'left: 50%',
      'top: 50%',
      'transform: translate(-50%, -50%)',
      'padding: 20px',
      'background: rgba(20, 24, 32, 0.96)',
      'border: 1px solid rgba(255, 255, 255, 0.25)',
      'border-radius: 8px',
      'box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35)',
      'color: white',
      'font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'text-align: center'
    ].join(';');

    const label = document.createElement('div');
    label.textContent = 'Click to join playback';
    label.style.marginBottom = '12px';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Join playback';
    button.style.cssText = [
      'padding: 8px 16px',
      'border: 0',
      'border-radius: 4px',
      'background: #2f80ed',
      'color: white',
      'font: inherit',
      'cursor: pointer'
    ].join(';');
    button.addEventListener('click', () => {
      const latestEvent = pendingFollowerEvent;
      if (!player || !latestEvent) return;
      const targetTime = expectedTime(latestEvent);
      suppressPlayerEvents = true;
      player.currentTime = Math.max(0, targetTime);
      const playPromise = player.play();
      Promise.resolve(playPromise).then(() => {
        suppressPlayerEvents = false;
        config.playbackActivated = true;
        saveConfig();
        pendingFollowerEvent = null;
        removePlaybackPrompt();
        log('follower playback joined', { targetTime });
      }).catch((reason) => {
        suppressPlayerEvents = false;
        log('follower video.play() rejected after ReviewIt button click', reason);
      });
    });
    container.append(label, button);
    document.documentElement.append(container);
    playbackPrompt = container;
  }

  function applyFollowerEvent(event) {
    if (config?.role !== 'FOLLOWER') return;
    if (event.type === 'NAVIGATE' && event.url && event.url !== location.href) {
      log('NAVIGATE', event.url);
      window.location.href = event.url;
      return;
    }
    if (!player || (event.url && event.url !== location.href)) {
      pendingFollowerEvent = event;
      return;
    }

    const targetTime = expectedTime(event);
    const drift = targetTime - player.currentTime;
    if (event.type === 'SEEK' || Math.abs(drift) > DRIFT_TOLERANCE_SECONDS) {
      log('follower drift correction', { drift, targetTime });
      suppressPlayerEvents = true;
      player.currentTime = Math.max(0, targetTime);
      suppressPlayerEvents = false;
    }
    suppressPlayerEvents = true;
    if (event.playing) {
      player.play().then(() => {
        suppressPlayerEvents = false;
        config.playbackActivated = true;
        saveConfig();
        removePlaybackPrompt();
      }).catch((reason) => {
        suppressPlayerEvents = false;
        log('follower video.play() rejected', reason);
        showPlaybackPrompt(event);
      });
      return;
    }
    player.pause();
    suppressPlayerEvents = false;
    pendingFollowerEvent = null;
    removePlaybackPrompt();
  }

  function sendReadyState() {
    if (config?.role === 'HOST' && player) sendHostEvent(currentEvent('STATE'));
  }

  function attachPlayer() {
    const nextPlayer = [...document.querySelectorAll('video')]
      .find((candidate) => candidate.offsetWidth > 0 && candidate.offsetHeight > 0) || document.querySelector('video');
    if (!nextPlayer || nextPlayer === player) return;
    player = nextPlayer;
    log('detected player', player);
    player.addEventListener('play', () => {
      if (config?.role === 'FOLLOWER' && !suppressPlayerEvents) {
        config.playbackActivated = true;
        saveConfig();
      }
      if (!suppressPlayerEvents) { log('PLAY'); sendHostEvent(currentEvent('PLAY')); }
    });
    player.addEventListener('pause', () => {
      if (!suppressPlayerEvents) { log('PAUSE'); sendHostEvent(currentEvent('PAUSE')); }
    });
    player.addEventListener('seeking', () => {
      seeking = true;
      if (!suppressPlayerEvents) { log('SEEK', player.currentTime); sendHostEvent(currentEvent('SEEK')); }
    });
    player.addEventListener('seeked', () => { seeking = false; });
    if (hostNavigationPending) {
      sendHostEvent(currentEvent('NAVIGATE'));
      hostNavigationPending = false;
    }
    sendReadyState();
    if (pendingFollowerEvent) {
      const event = pendingFollowerEvent;
      pendingFollowerEvent = null;
      applyFollowerEvent(event);
    }
  }

  function detectNavigation() {
    if (location.href === lastUrl) return;
    const oldUrl = lastUrl;
    lastUrl = location.href;
    log('detected Box file', location.href);
    if (config?.role === 'HOST') {
      sendHostEvent(currentEvent('NAVIGATE', { from: oldUrl }));
      config.lastUrl = location.href;
      saveConfig();
    }
    player = null;
    attachPlayer();
  }

  function connect() {
    if (!reconnectEnabled || !config || socket || !config.role) return;
    socket = new WebSocket(RELAY_URL);
    socket.addEventListener('open', () => {
      log('room connection', config.role, config.roomId || '(new room)');
      socket.send(JSON.stringify(config.role === 'HOST'
        ? { type: 'HELLO', role: 'HOST', roomId: config.roomId }
        : { type: 'JOIN', role: 'FOLLOWER', roomId: config.roomId }));
    });
    socket.addEventListener('message', ({ data }) => {
      const incoming = JSON.parse(data);
      if (incoming.type === 'ROOM') {
        config.roomId = incoming.roomId;
        config.lastUrl = location.href;
        saveConfig();
        log('room connection', incoming.roomId);
      } else if (incoming.type === 'JOINED') {
        log('room connection', incoming.roomId);
        if (incoming.state) applyFollowerEvent(incoming.state);
      } else if (incoming.type === 'HOST_EVENT') {
        applyFollowerEvent(incoming.event);
      } else if (incoming.type === 'ERROR') {
        log(incoming.message);
      }
    });
    socket.addEventListener('close', () => {
      socket = null;
      if (reconnectEnabled) setTimeout(connect, 1000);
    });
  }

  function resetReview() {
    reconnectEnabled = false;
    config = null;
    pendingFollowerEvent = null;
    hostNavigationPending = false;
    if (socket) {
      socket.close();
      socket = null;
    }
    chrome.storage.local.remove('boxReviewConfig');
    log('review session cleared');
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_HOST') {
      reconnectEnabled = true;
      if (config?.role !== 'HOST') {
        if (socket) socket.close();
        socket = null;
        config = { role: 'HOST' };
      }
      saveConfig();
      connect();
      sendResponse(message('Host room is connecting...'));
    } else if (request.type === 'START_FOLLOWER') {
      reconnectEnabled = true;
      if (config?.role !== 'FOLLOWER' && socket) {
        socket.close();
        socket = null;
      }
      config = { role: 'FOLLOWER', roomId: request.roomId };
      saveConfig();
      connect();
      sendResponse(message(`Follower joining ${request.roomId}...`));
    } else if (request.type === 'STOP_REVIEW') {
      resetReview();
      sendResponse(message('Not in a review'));
    } else if (request.type === 'GET_STATUS') {
      sendResponse(message(config ? `${config.role}${config.roomId ? ` in ${config.roomId}` : ''}` : 'Not in a review'));
    }
    return true;
  });

  chrome.storage.local.get('boxReviewConfig', (result) => {
    config = result.boxReviewConfig || null;
    hostNavigationPending = config?.role === 'HOST' && config.lastUrl && config.lastUrl !== location.href;
    connect();
  });

  const observer = new MutationObserver(() => { attachPlayer(); detectNavigation(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    attachPlayer();
    detectNavigation();
    if (config?.role === 'HOST' && player && !seeking) sendHostEvent(currentEvent('STATE'));
  }, HEARTBEAT_MS);
  log('Box content script ready', location.href);
})();