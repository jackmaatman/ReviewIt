(() => {
  const RELAY_URL = 'wss://reviewit-zoba.onrender.com';
  const roomId = new URLSearchParams(location.search).get('room')?.trim().toUpperCase();
  const status = (text) => { document.body.innerText = text; };

  if (!roomId || roomId.length !== 4) {
    status('Invalid ReviewIt link.');
    return;
  }

  status(`Joining ReviewIt room ${roomId}...`);
  const socket = new WebSocket(RELAY_URL);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'JOIN', role: 'FOLLOWER', roomId }));
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'JOINED') {
      const state = message.state;
      if (!state?.url) {
        status('The host has not opened playable media yet.');
        return;
      }
      chrome.storage.local.set({
        boxReviewConfig: { role: 'FOLLOWER', roomId: message.roomId }
      }, () => {
        socket.close();
        location.replace(state.url);
      });
    } else if (message.type === 'ERROR') {
      status(`Unable to join room ${roomId}: ${message.message}.`);
      socket.close();
    }
  });
  socket.addEventListener('error', () => status('Unable to connect to the ReviewIt server.'));
})();