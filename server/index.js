// server/index.js
//
// Entry point for the real-time chat server.
// Stack: Express (serves the static frontend) + Socket.IO (real-time layer).
//
// All state (connected users, usernames) lives in memory only. There is no
// database and no persistence — if the server restarts, chat history and
// user sessions are gone, which is expected/by-design per the requirements.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { generateUsername } = require('./utils/usernameGenerator');
const { escapeHtml } = require('./utils/sanitize');
const { tryConsume, removeBucket } = require('./utils/rateLimiter');

const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 500;

const app = express();
const server = http.createServer(app);
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

// Map<socketId, { username: string, isTyping: boolean }>
const connectedUsers = new Map();

// Set of usernames currently used with active "typing" status (for cleanup)
function getOnlineCount() {
  return connectedUsers.size;
}

function broadcastOnlineCount() {
  io.emit('online count', getOnlineCount());
}

function broadcastUserList() {
  const usernames = Array.from(connectedUsers.values()).map((u) => u.username);
  io.emit('user list', usernames);
}

// ---------------------------------------------------------------------------
// Socket.IO connection handling
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  // Assign a random username immediately — no login/signup required.
  const username = generateUsername();
  connectedUsers.set(socket.id, { username, isTyping: false });

  // Tell this client who they are.
  socket.emit('welcome', {
    username,
    onlineCount: getOnlineCount(),
  });

  // Notify everyone (including the new user) that someone joined.
  io.emit('system message', {
    type: 'join',
    username,
    timestamp: Date.now(),
  });

  broadcastOnlineCount();
  broadcastUserList();

  // -------------------------------------------------------------------
  // Chat messages
  // -------------------------------------------------------------------
  socket.on('chat message', (rawText) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

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

    // Sanitize to prevent XSS before broadcasting to all clients.
    const safeText = escapeHtml(trimmed);

    io.emit('chat message', {
      username: user.username,
      text: safeText,
      timestamp: Date.now(),
    });

    // Sending a message implicitly stops "typing" state.
    if (user.isTyping) {
      user.isTyping = false;
      socket.broadcast.emit('stop typing', { username: user.username });
    }
  });

  // -------------------------------------------------------------------
  // Typing indicators
  // -------------------------------------------------------------------
  socket.on('typing', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    if (!user.isTyping) {
      user.isTyping = true;
      socket.broadcast.emit('typing', { username: user.username });
    }
  });

  socket.on('stop typing', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    if (user.isTyping) {
      user.isTyping = false;
      socket.broadcast.emit('stop typing', { username: user.username });
    }
  });

  // -------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    connectedUsers.delete(socket.id);
    removeBucket(socket.id);

    io.emit('system message', {
      type: 'leave',
      username: user.username,
      timestamp: Date.now(),
    });

    // Ensure a lingering "typing" indicator doesn't get stuck for others.
    if (user.isTyping) {
      socket.broadcast.emit('stop typing', { username: user.username });
    }

    broadcastOnlineCount();
    broadcastUserList();
  });
});

server.listen(PORT, () => {
  console.log(`✅ Chat server running at http://localhost:${PORT}`);
});
