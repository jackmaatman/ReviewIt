(() => {
  const visibleVideo = (root = document) => {
    const video = [...root.querySelectorAll('video')]
      .find((candidate) => candidate.offsetWidth > 0 && candidate.offsetHeight > 0)
      || root.querySelector('video');
    if (video) return video;
    for (const frame of root.querySelectorAll('iframe')) {
      try {
        const nestedVideo = visibleVideo(frame.contentDocument);
        if (nestedVideo) return nestedVideo;
      } catch {
      }
    }
    return null;
  };

  const nativeVideoAdapter = (name, matches, mediaIdFromUrl) => ({
    name,
    detect() {
      return matches(location);
    },
    getCurrentUrl() {
      return location.href;
    },
    getCurrentMediaId() {
      return mediaIdFromUrl(location.href);
    },
    getVideoElement() {
      return visibleVideo();
    },
    getCurrentTime(video) {
      return video?.currentTime || 0;
    },
    isPlaying(video) {
      return Boolean(video && !video.paused);
    },
    play(video) {
      return video.play();
    },
    pause(video) {
      video.pause();
    },
    seek(video, time) {
      video.currentTime = time;
    },
    observePlaybackEvents(video, handlers) {
      video.addEventListener('play', handlers.play);
      video.addEventListener('pause', handlers.pause);
      video.addEventListener('seeking', handlers.seeking);
      video.addEventListener('seeked', handlers.seeked);
    },
    observeNavigation() {},
    cleanup() {}
  });

  const box = nativeVideoAdapter(
    'box',
    (location) => location.hostname === 'box.com' || location.hostname.endsWith('.box.com'),
    (url) => url.match(/\/file\/([^/?#]+)/)?.[1] || url
  );

  const googleDrive = nativeVideoAdapter(
    'google-drive',
    (location) => location.hostname === 'drive.google.com',
    (url) => url.match(/\/file\/d\/([^/]+)/)?.[1] || url.match(/[?&]id=([^&]+)/)?.[1] || url
  );

  const driveFrame = (() => {
    let activeFrame = null;
    let activeOrigin = '*';
    let remoteVideo = null;
    let playbackHandlers = null;
    let requestId = 0;
    const pendingCommands = new Map();

    const log = (...args) => console.log('[ReviewIt] google-drive adapter', ...args);

    function sendCommand(command, time) {
      if (!activeFrame) return Promise.reject(new Error('Drive player frame is not attached'));
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        pendingCommands.set(id, { resolve, reject });
        activeFrame.postMessage({ source: 'reviewit-drive-controller', command, time, requestId: id }, activeOrigin);
      });
    }

    function updateRemoteState(message) {
      remoteVideo = {
        currentTime: message.state?.currentTime || 0,
        paused: message.state?.paused ?? true,
        duration: message.state?.duration || 0,
        receivedAt: Date.now()
      };
    }

    window.addEventListener('message', (event) => {
      if (event.data?.source !== 'reviewit-drive-frame') return;
      const message = event.data;
      if (message.type === 'DRIVE_PLAYER_READY' || (message.type === 'DRIVE_FRAME_DIAGNOSTIC' && message.state?.hasVideo)) {
        activeFrame = event.source;
        activeOrigin = event.origin;
        updateRemoteState(message);
        log('frame attached', message.state);
        return;
      }
      if (message.type === 'DRIVE_PLAYER_EVENT') {
        activeFrame = event.source;
        activeOrigin = event.origin;
        updateRemoteState(message);
        const handler = playbackHandlers?.[message.event];
        if (handler) handler();
        return;
      }
      if (message.type === 'DRIVE_COMMAND_RESULT') {
        updateRemoteState(message);
        const pending = pendingCommands.get(message.requestId);
        if (!pending) return;
        pendingCommands.delete(message.requestId);
        if (message.ok) pending.resolve();
        else pending.reject(new Error(message.error || 'Drive player command failed'));
        return;
      }
      if (message.type === 'DRIVE_PLAYBACK_ACTIVATED') {
        playbackHandlers?.playbackActivated?.();
      }
    });

    return {
      ...googleDrive,
      getVideoElement() {
        return remoteVideo;
      },
      getCurrentTime() {
        if (!remoteVideo) return 0;
        const elapsed = remoteVideo.paused ? 0 : (Date.now() - remoteVideo.receivedAt) / 1000;
        return remoteVideo.currentTime + elapsed;
      },
      isPlaying() {
        return Boolean(remoteVideo && !remoteVideo.paused);
      },
      play() {
        return sendCommand('play');
      },
      pause() {
        return sendCommand('pause');
      },
      seek(_video, time) {
        return sendCommand('seek', time);
      },
      observePlaybackEvents(_video, handlers) {
        playbackHandlers = handlers;
      },
      showPlaybackPrompt(event) {
        if (!activeFrame) return;
        activeFrame.postMessage({
          source: 'reviewit-drive-controller',
          command: 'show-playback-prompt',
          event
        }, activeOrigin);
      },
      clearPlaybackPrompt() {
        if (!activeFrame) return;
        activeFrame.postMessage({
          source: 'reviewit-drive-controller',
          command: 'hide-playback-prompt'
        }, activeOrigin);
      }
    };
  })();

  window.ReviewItProviders = {
    detect() {
      if (box.detect()) return box;
      if (googleDrive.detect()) return driveFrame;
      return null;
    }
  };
})();
