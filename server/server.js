import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT || 8787);
const rooms = new Map();

function makeRoomId() {
  let roomId;
  do {
    roomId = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(roomId));
  return roomId;
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except) {
  for (const socket of room.followers) {
    if (socket !== except) send(socket, message);
  }
}

const wss = new WebSocketServer({ host: '0.0.0.0', port });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'HELLO' && message.role === 'HOST') {
      const requestedRoomId = String(message.roomId || '').toUpperCase();
      const roomId = requestedRoomId && rooms.has(requestedRoomId) ? requestedRoomId : makeRoomId();
      const room = rooms.get(roomId) || { host: null, followers: new Set(), state: null };
      room.host = socket;
      rooms.set(roomId, room);
      socket.roomId = roomId;
      socket.role = 'HOST';
      send(socket, { type: 'ROOM', roomId });
      console.log(`[relay] host created room ${roomId}`);
      return;
    }

    if (message.type === 'JOIN' && message.roomId) {
      const room = rooms.get(String(message.roomId).toUpperCase());
      if (!room || !room.host) {
        send(socket, { type: 'ERROR', message: 'Room not found' });
        return;
      }
      socket.roomId = String(message.roomId).toUpperCase();
      socket.role = 'FOLLOWER';
      room.followers.add(socket);
      send(socket, { type: 'JOINED', roomId: socket.roomId, state: room.state });
      console.log(`[relay] follower joined room ${socket.roomId}`);
      return;
    }

    if (message.type === 'HOST_EVENT' && socket.role === 'HOST') {
      const room = rooms.get(socket.roomId);
      if (!room) return;
      room.state = message.event;
      broadcast(room, { type: 'HOST_EVENT', event: message.event });
    }
  });

  socket.on('close', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    if (socket.role === 'HOST' && room.host === socket) {
      room.host = null;
      console.log(`[relay] host disconnected from room ${socket.roomId}; waiting for reconnect`);
      setTimeout(() => {
        if (rooms.get(socket.roomId)?.host === null) rooms.delete(socket.roomId);
      }, 30000);
    } else {
      room.followers.delete(socket);
    }
  });
});

console.log(`[relay] listening on 0.0.0.0:${port}`);