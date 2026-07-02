# Global Chat — Real-Time Chat App

A no-login, no-signup, real-time global chat room. Open the site, get a
random username instantly, and start chatting. Built with Node.js,
Express, and Socket.IO.

## Features

- **No accounts** — a random username (e.g. `BlueTiger482`) is assigned
  automatically on connect.
- **Instant global chat** — every visitor joins the same room immediately.
- **Real-time messaging** via WebSockets (Socket.IO).
- **Join/leave notifications** and a **live online user count**.
- **"User is typing..." indicator.**
- **Enter to send, Shift+Enter for a new line.**
- **Responsive, Discord-inspired dark UI.**
- **XSS protection** — all message text is HTML-escaped server-side before
  broadcast.
- **500-character message limit.**
- **Server-side rate limiting** to reduce spam (token-bucket per
  connection, with temporary mute on abuse).
- **No database** — all state lives in memory; a server restart clears
  users and message history, by design.

## Project Structure

```
chat-app/
├── package.json
├── README.md
├── server/
│   ├── index.js                 # Express + Socket.IO server entry point
│   └── utils/
│       ├── usernameGenerator.js # Random username generator
│       ├── sanitize.js          # XSS-safe HTML escaping
│       └── rateLimiter.js       # Per-socket rate limiting (token bucket)
└── public/
    ├── index.html                # Chat UI markup
    ├── css/
    │   └── style.css             # Dark theme, responsive layout
    └── js/
        └── app.js                # Client-side Socket.IO logic
```

## Requirements

- Node.js 16 or newer
- npm

## Install & Run

```bash
npm install
npm start
```

Then open your browser at:

```
http://localhost:3000
```

Open the same URL in multiple browser tabs/windows (or from different
devices on the same network) to see real-time chat, join/leave events,
typing indicators, and the online count update live.

### Optional: change the port

```bash
PORT=4000 npm start
```

## How It Works

1. **Connection** — when a browser opens the site, the client connects via
   Socket.IO. The server immediately generates a random username for that
   socket and sends a `welcome` event back with it.
2. **Messaging** — the client emits a `chat message` event; the server
   validates length, applies rate limiting, HTML-escapes the text, and
   broadcasts it to everyone via `io.emit('chat message', ...)`.
3. **Typing indicator** — the client emits `typing` on keystrokes (debounced)
   and `stop typing` after a pause or on send; the server relays these to
   other connected clients.
4. **Presence** — on connect/disconnect the server broadcasts
   `system message` (join/leave), an updated `online count`, and the full
   `user list`.
5. **No persistence** — everything above lives in a couple of in-memory
   `Map`/`Set` structures in `server/index.js`. Restarting the process
   wipes all of it clean, which is the intended behavior for this
   lightweight, account-free chat room.

## Security Notes

- All chat text is escaped server-side (`server/utils/sanitize.js`) before
  it is ever broadcast, so no client can inject HTML/JS into another
  user's browser.
- Message length is enforced both client-side (UX) and server-side
  (authoritative).
- Rate limiting is enforced server-side per socket connection and cannot
  be bypassed by a malicious client.
- Usernames are generated and controlled entirely server-side, so a client
  cannot spoof another user's identity.
