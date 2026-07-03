// server/index.js
//
// Entry point for the real-time chat server.
// Stack: Express (serves the static frontend) + Socket.IO (real-time layer).
//
// All state (usernames, rooms, connected users) lives in memory only.
// There is no database and no persistence — if the server restarts,
// rooms, chat history, and user sessions are all gone, which is
// expected/by-design per the requirements.
//
// Account model: there are no accounts. A visitor picks a display
// username (3-20 chars: letters, numbers, underscore) that must be
// unique among currently-connected users. No password, no email, no
// third-party login. The username only "belongs" to a session for as
// long as that socket stays connected.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const { escapeHtml } = require('./utils/sanitize');
const { tryConsume, removeBucket } = require('./utils/rateLimiter');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_VOICE_DATA_URL_LENGTH = 2 * 1024 * 1024 * 1.4; // ~2MB audio, base64-inflated
const MAX_VOICE_DURATION_MS = 60 * 1000; // 60 seconds
const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
const ROOM_NAME_REGEX = /^[A-Za-z0-9_\- ]{1,30}$/;
const GLOBAL_ROOM_ID = 'global';

const app = express();

// ---------------------------------------------------------------------------
// HTTPS setup
// ---------------------------------------------------------------------------
// If a certificate + key are present (either generated locally via
// `npm run generate-cert` or supplied in production via env vars), the
// server starts over HTTPS. Otherwise it falls back to plain HTTP, which
// is fine for local development or when TLS is terminated by a reverse
// proxy (e.g. Nginx, Caddy) in front of this app — see README.md.
const CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'certs', 'cert.pem');
const KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, '..', 'certs', 'key.pem');

const certsExist = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
const useHttps = process.env.FORCE_HTTPS === 'true' || certsExist;

let server;
if (useHttps) {
  const credentials = {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
  };
  server = https.createServer(credentials, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: '*', // Adjust in production if serving frontend from a different origin
  },
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

// Map<socketId, { username, currentRoom, isTyping }>
const connectedUsers = new Map();

// Map<lowercaseUsername, socketId> — enforces "unique while online".
const usernamesInUse = new Map();

// Map<roomId, { id, name, createdAt, creatorUsername, members: Set<socketId> }>
const rooms = new Map();

// The Global room always exists, cannot be deleted, and is where every
// user lands by default.
rooms.set(GLOBAL_ROOM_ID, {
  id: GLOBAL_ROOM_ID,
  name: 'Global',
  createdAt: Date.now(),
  creatorUsername: null, // system room — no creator, cannot be deleted
  members: new Set(),
});

function getOnlineCount() {
  return connectedUsers.size;
}

function getRoomPayload(room) {
  return {
    id: room.id,
    name: room.name,
    onlineCount: room.members.size,
    createdAt: room.createdAt,
    creatorUsername: room.creatorUsername,
  };
}

function broadcastOnlineCount() {
  io.emit('online count', getOnlineCount());
}

function broadcastRoomList() {
  const list = Array.from(rooms.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(getRoomPayload);
  io.emit('room list', list);
}

function broadcastRoomUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const usernames = Array.from(room.members)
    .map((sid) => connectedUsers.get(sid))
    .filter(Boolean)
    .map((u) => u.username);
  io.to(roomId).emit('room user list', { roomId, usernames });
}

/**
 * Moves a socket into a room: joins the Socket.IO room, updates state,
 * announces to the room, and refreshes room/user lists for everyone.
 */
function joinRoom(socket, user, roomId, { announce = true } = {}) {
  const room = rooms.get(roomId);
  if (!room) return false;

  socket.join(roomId);
  room.members.add(socket.id);
  user.currentRoom = roomId;

  if (announce) {
    io.to(roomId).emit('system message', {
      type: 'join',
      username: user.username,
      roomId,
      timestamp: Date.now(),
    });
  }

  broadcastRoomUserList(roomId);
  broadcastRoomList();
  return true;
}

/**
 * Removes a socket from a room it currently occupies.
 */
function leaveRoom(socket, user, roomId, { announce = true } = {}) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.leave(roomId);
  room.members.delete(socket.id);

  if (announce) {
    io.to(roomId).emit('system message', {
      type: 'leave',
      username: user.username,
      roomId,
      timestamp: Date.now(),
    });
  }

  broadcastRoomUserList(roomId);
  broadcastRoomList();
}

function generateRoomId() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  // No user is registered on this socket yet — the client must claim a
  // username first (see 'set username' below) before doing anything else.

  // -------------------------------------------------------------------
  // Username claim ("account" system — no passwords, just a unique
  // display name for the duration of the connection)
  // -------------------------------------------------------------------
  socket.on('set username', (rawUsername) => {
    // If this socket already has a username, ignore repeat attempts.
    if (connectedUsers.has(socket.id)) return;

    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';

    if (!USERNAME_REGEX.test(username)) {
      socket.emit('username rejected', {
        reason:
          'Username must be 3-20 characters and contain only letters, numbers, and underscores.',
      });
      return;
    }

    const key = username.toLowerCase();
    if (usernamesInUse.has(key)) {
      socket.emit('username rejected', {
        reason: 'This username is already in use.',
      });
      return;
    }

    // Register the user.
    usernamesInUse.set(key, socket.id);
    const user = { username, currentRoom: null, isTyping: false };
    connectedUsers.set(socket.id, user);

    // Join the Global room by default.
    joinRoom(socket, user, GLOBAL_ROOM_ID);

    socket.emit('username accepted', {
      username,
      onlineCount: getOnlineCount(),
      rooms: Array.from(rooms.values())
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(getRoomPayload),
      currentRoom: GLOBAL_ROOM_ID,
    });

    broadcastOnlineCount();
  });

  // -------------------------------------------------------------------
  // Chat messages — scoped to the sender's current room only
  // -------------------------------------------------------------------
  socket.on('chat message', (rawText) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;

    // Rate limiting — protect against spam/flooding.
    const rateResult = tryConsume(socket.id);
    if (!rateResult.allowed) {
      socket.emit('rate limited', {
        mutedMsRemaining: rateResult.mutedMsRemaining || 0,
      });
      return;
    }

    // Validate input type and length.
    if (typeof rawText !== 'string') return;
    const trimmed = rawText.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      socket.emit('message error', {
        reason: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit.`,
      });
      return;
    }

    // Sanitize to prevent XSS before broadcasting.
    const safeText = escapeHtml(trimmed);

    // Only the sender's current room receives the message.
    io.to(user.currentRoom).emit('chat message', {
      username: user.username,
      text: safeText,
      roomId: user.currentRoom,
      timestamp: Date.now(),
    });

    // Sending a message implicitly stops "typing" state.
    if (user.isTyping) {
      user.isTyping = false;
      socket.to(user.currentRoom).emit('stop typing', { username: user.username });
    }
  });

  // -------------------------------------------------------------------
  // Voice messages — scoped to the sender's current room, same rate
  // limiter and room scoping as text messages. Audio is sent as a
  // base64 data URL (e.g. "data:audio/webm;base64,...") and relayed
  // as-is; it is never persisted (no database, same as text messages).
  // -------------------------------------------------------------------
  socket.on('voice message', (payload) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;

    // Reuses the same token-bucket limiter as text messages.
    const rateResult = tryConsume(socket.id);
    if (!rateResult.allowed) {
      socket.emit('rate limited', {
        mutedMsRemaining: rateResult.mutedMsRemaining || 0,
      });
      return;
    }

    const audio = payload && typeof payload.audio === 'string' ? payload.audio : null;
    const durationMs = payload && typeof payload.durationMs === 'number' ? payload.durationMs : 0;

    if (!audio || !audio.startsWith('data:audio/')) {
      socket.emit('message error', { reason: 'Invalid voice message.' });
      return;
    }
    if (audio.length > MAX_VOICE_DATA_URL_LENGTH) {
      socket.emit('message error', { reason: 'Voice message is too large.' });
      return;
    }
    if (durationMs > MAX_VOICE_DURATION_MS) {
      socket.emit('message error', { reason: 'Voice message exceeds the 60 second limit.' });
      return;
    }

    io.to(user.currentRoom).emit('voice message', {
      username: user.username,
      audio,
      durationMs,
      roomId: user.currentRoom,
      timestamp: Date.now(),
    });

    if (user.isTyping) {
      user.isTyping = false;
      socket.to(user.currentRoom).emit('stop typing', { username: user.username });
    }
  });

  // -------------------------------------------------------------------
  // Typing indicators — scoped to current room only
  // -------------------------------------------------------------------
  socket.on('typing', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    if (!user.isTyping) {
      user.isTyping = true;
      socket.to(user.currentRoom).emit('typing', { username: user.username });
    }
  });

  socket.on('stop typing', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    if (user.isTyping) {
      user.isTyping = false;
      socket.to(user.currentRoom).emit('stop typing', { username: user.username });
    }
  });

  // -------------------------------------------------------------------
  // Rooms: create / join / leave / delete
  // -------------------------------------------------------------------
  socket.on('create room', (rawName) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';

    if (!ROOM_NAME_REGEX.test(name)) {
      socket.emit('room error', {
        reason: 'Room name must be 1-30 characters (letters, numbers, spaces, - or _).',
      });
      return;
    }

    const nameKey = name.toLowerCase();
    const duplicate = Array.from(rooms.values()).some((r) => r.name.toLowerCase() === nameKey);
    if (duplicate) {
      socket.emit('room error', { reason: 'A room with that name already exists.' });
      return;
    }

    const roomId = generateRoomId();
    rooms.set(roomId, {
      id: roomId,
      name,
      createdAt: Date.now(),
      creatorUsername: user.username,
      members: new Set(),
    });

    leaveRoom(socket, user, user.currentRoom);
    joinRoom(socket, user, roomId);

    socket.emit('room joined', { roomId });
  });

  socket.on('join room', (roomId) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    if (typeof roomId !== 'string' || !rooms.has(roomId)) {
      socket.emit('room error', { reason: 'That room no longer exists.' });
      return;
    }
    if (user.currentRoom === roomId) return;

    leaveRoom(socket, user, user.currentRoom);
    joinRoom(socket, user, roomId);
    socket.emit('room joined', { roomId });
  });

  socket.on('leave room', () => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    if (user.currentRoom === GLOBAL_ROOM_ID) return; // already home, nothing to do

    leaveRoom(socket, user, user.currentRoom);
    joinRoom(socket, user, GLOBAL_ROOM_ID);
    socket.emit('room joined', { roomId: GLOBAL_ROOM_ID });
  });

  socket.on('delete room', (roomId) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    if (roomId === GLOBAL_ROOM_ID) {
      socket.emit('room error', { reason: 'The Global room cannot be deleted.' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('room error', { reason: 'That room no longer exists.' });
      return;
    }

    if (room.creatorUsername !== user.username) {
      socket.emit('room error', { reason: 'Only the room creator can delete this room.' });
      return;
    }

    // Relocate any members currently in the room back to Global.
    const memberIds = Array.from(room.members);
    memberIds.forEach((sid) => {
      const memberSocket = io.sockets.sockets.get(sid);
      const memberUser = connectedUsers.get(sid);
      if (!memberSocket || !memberUser) return;

      memberSocket.leave(roomId);
      memberUser.currentRoom = GLOBAL_ROOM_ID;
      rooms.get(GLOBAL_ROOM_ID).members.add(sid);
      memberSocket.join(GLOBAL_ROOM_ID);
      memberSocket.emit('room deleted', { roomId, redirectTo: GLOBAL_ROOM_ID });
    });

    rooms.delete(roomId);
    broadcastRoomList();
    broadcastRoomUserList(GLOBAL_ROOM_ID);

    io.to(GLOBAL_ROOM_ID).emit('system message', {
      type: 'info',
      text: `Room "${room.name}" was deleted by its creator.`,
      roomId: GLOBAL_ROOM_ID,
      timestamp: Date.now(),
    });
  });

  // -------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    if (user.currentRoom) {
      leaveRoom(socket, user, user.currentRoom);
    }

    usernamesInUse.delete(user.username.toLowerCase());
    connectedUsers.delete(socket.id);
    removeBucket(socket.id);

    broadcastOnlineCount();
  });
});

server.listen(PORT, () => {
  const protocol = useHttps ? 'https' : 'http';
  console.log(`✅ Chat server running at ${protocol}://localhost:${PORT}`);
  if (!useHttps) {
    console.log('   (Running over HTTP. Run "npm run generate-cert" for local HTTPS.)');
  }
});
