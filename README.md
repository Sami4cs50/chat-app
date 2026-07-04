# Global Chat — Real-Time Chat App

A no-signup, no-password chat app. Pick a username, jump into the Global
room, and create or join topic rooms — all in real time over WebSockets.
Built with Node.js, Express, and Socket.IO.

## Features

- **No accounts, no passwords** — pick a unique display username (3–20
  characters: letters, numbers, underscores) and you're in.
- **Username persistence** — your username is saved in `localStorage` and
  reused automatically on your next visit. If it's already taken by
  someone else online, you're asked to pick another.
- **Chat rooms** — a permanent **Global** room plus user-created rooms:
  create, join, leave, and delete (creator only).
- **🤖 AI Assistant room** — a permanent, private room where each user has
  their own 1:1 conversation with an AI. Two users in this room never see
  each other's messages. The AI asks for your name on first visit,
  remembers it (and anything else you tell it) across restarts via
  SQLite, and can hold a full voice conversation: speak with your
  microphone, hear natural spoken replies, mute/unmute, and see live
  "thinking" and "speaking" animations.
- **Real-time messaging** via WebSockets (Socket.IO), scoped per room —
  you only receive messages from the room you're currently in.
- **Room sidebar** — lists all rooms with live online counts; the room
  you're in is highlighted.
- **Join/leave notifications** and a **live online user count** (site-wide
  and per room).
- **"User is typing..." indicator**, scoped to your current room.
- **Voice messages** — click the mic button to start recording, click
  again to stop and send; played back inline with a native audio player.
  Capped at 60 seconds and ~2MB, rate-limited the same as text messages,
  and never persisted.
- **Enter to send, Shift+Enter for a new line.**
- **Responsive, Discord-inspired dark UI.**
- **Optional HTTPS** — run the server directly over TLS using a local
  self-signed cert (dev) or a real cert (production).
- **XSS protection** — all message text is HTML-escaped server-side before
  broadcast.
- **500-character message limit.**
- **Server-side rate limiting** to reduce spam (token-bucket per
  connection, with temporary mute on abuse).
- **No database** — all state (usernames, rooms, messages) lives in
  memory; a server restart clears everything, by design.

## Project Structure

```
chat-app/
├── package.json
├── README.md
├── .gitignore
├── certs/                        # (created by you) local TLS cert/key for HTTPS
├── data/                         # SQLite database for the AI Assistant room (auto-created)
│   └── ai-assistant.db
├── scripts/
│   └── generate-cert.sh          # generates a self-signed cert for local HTTPS
├── server/
│   ├── index.js                  # Express + Socket.IO server, rooms, AI room logic
│   ├── db.js                     # SQLite persistence for AI memory + chat history
│   └── utils/
│       ├── sanitize.js           # XSS-safe HTML escaping
│       ├── rateLimiter.js        # Per-socket rate limiting (token bucket)
│       ├── aiClient.js           # OpenAI chat completions + text-to-speech calls
│       └── nameExtractor.js      # Parses "my name is X" style replies
└── public/
    ├── index.html                 # Welcome screen + chat UI + AI room markup
    ├── css/
    │   └── style.css              # Dark theme, responsive layout, AI room UI
    └── js/
        └── app.js                 # Client-side Socket.IO logic (rooms, voice, AI)
```

## Requirements

- Node.js 18 or newer (uses the built-in global `fetch` to call OpenAI)
- npm
- `openssl` (only if you want to generate a local HTTPS certificate)
- An [OpenAI API key](https://platform.openai.com/api-keys) (only needed
  for the 🤖 AI Assistant room — the rest of the app works without one)

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
devices on the same network) to see real-time chat, rooms, join/leave
events, typing indicators, and the online count update live. Give each
tab a different username.

### Optional: change the port

```bash
PORT=4000 npm start
```

## Setting Up the 🤖 AI Assistant Room

The AI Assistant room works out of the box for browsing/joining, but to
get real responses (instead of a "not configured yet" notice) you need an
OpenAI API key:

```bash
OPENAI_API_KEY=sk-your-key-here npm start
```

Optional environment variables to customize it further:

| Variable              | Default      | Purpose                                             |
|------------------------|--------------|------------------------------------------------------|
| `OPENAI_API_KEY`       | *(none)*     | Required for the AI to respond at all.               |
| `OPENAI_CHAT_MODEL`    | `gpt-4o-mini`| Chat completion model used for replies.              |
| `OPENAI_TTS_MODEL`     | `tts-1`      | Text-to-speech model.                                |
| `OPENAI_TTS_VOICE`     | `nova`       | Voice used for spoken replies (`nova`/`shimmer` are OpenAI's natural, female-sounding options). |
| `DB_PATH`              | `data/ai-assistant.db` | Where the SQLite database file lives.      |

Without an API key set, the AI room still works structurally (you can
open it, it'll ask your name, etc.) but replies with a friendly
"the AI assistant isn't configured yet" message instead of a real answer.

**Browser support note:** the "Start Listening" voice-input feature uses
the browser's built-in Web Speech API (`SpeechRecognition`), which is
supported in Chrome, Edge, and Safari, but not in Firefox at the time of
writing. Typing still works everywhere regardless. Voice **playback**
(the AI speaking back to you) works in every modern browser since it's
just an `<audio>` element playing an MP3 from OpenAI's TTS API.

## Running Over HTTPS

### Local development (self-signed certificate)

```bash
npm run generate-cert
npm start
```

This generates `certs/key.pem` and `certs/cert.pem`. On startup, the
server detects them automatically and switches to HTTPS:

```
https://localhost:3000
```

Your browser will show a security warning because the certificate is
self-signed — that's expected. Click **Advanced → Proceed** to continue.
This is normal for local development and does not affect the app's
functionality (WebSocket traffic is still encrypted).

### Production (trusted certificate, no warnings)

You have two options:

**Option A — Point the server at a real certificate.** If you already
have a certificate (e.g. from Let's Encrypt/Certbot), point the server at
it with environment variables instead of the generated dev cert:

```bash
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem \
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem \
npm start
```

**Option B (recommended) — Terminate TLS at a reverse proxy.** Run this
app over plain HTTP on `localhost` and put Nginx or Caddy in front of it
to handle HTTPS and certificate renewal. Example Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

The `Upgrade`/`Connection` headers above are required for Socket.IO's
WebSocket handshake to pass through the proxy correctly.

## How It Works

### Usernames (no accounts)

1. On first visit, the client shows a full-screen welcome form asking for
   a username.
2. On submit, the client emits `set username`. The server validates it
   (3–20 chars, letters/numbers/underscores) and checks it isn't already
   in use by another connected socket (case-insensitive).
   - If invalid or taken, the server replies with `username rejected`
     and a reason (e.g. *"This username is already in use."*), and the
     welcome form is shown again.
   - If accepted, the server replies with `username accepted`, the
     client saves the username to `localStorage`, hides the welcome
     screen, and joins the Global room.
3. On future visits, the client automatically retries the saved username
   from `localStorage` as soon as it connects. If that username is
   already taken (e.g. you have another tab open), the welcome screen
   reappears so you can choose a different one.
4. Usernames are **server-assigned ownership** — a client can never claim
   or spoof a username that's currently held by another connection, and
   a username is freed up the moment its socket disconnects.

### Rooms

- The **Global** room always exists, can't be deleted, and is where every
  user starts.
- **Create room** — emits `create room` with a name (1–30 characters);
  the server creates it, makes you its creator, and moves you into it.
- **Join room** — emits `join room` with a room ID; you leave your
  current room and join the target one.
- **Leave room** — emits `leave room`; moves you back to Global (a no-op
  if you're already in Global).
- **Delete room** — emits `delete room`; only works if you're the
  creator. All members currently in that room are moved back to Global
  and notified, and the room is removed for everyone.
- Socket.IO's built-in **room** feature (`socket.join`/`socket.leave`) is
  used so messages, typing indicators, and presence are only ever sent to
  sockets in the relevant room — no manual filtering needed on the wire.
- The sidebar's room list (with live online counts) is broadcast to
  *everyone*, regardless of which room they're in, so you can always see
  what rooms exist and how busy they are.

### Messaging & Presence

- The client emits `chat message`; the server validates length, applies
  rate limiting, HTML-escapes the text, and broadcasts it only to the
  sender's current room (`io.to(roomId).emit(...)`).
- Typing indicators (`typing` / `stop typing`) work the same way — scoped
  to the current room.
- Join/leave system messages are posted to the room being entered/left,
  not the whole site.
- **No persistence for regular rooms** — everything lives in a few
  in-memory `Map`/`Set` structures in `server/index.js`. Restarting the
  process wipes all users, rooms, and messages there, which is the
  intended behavior for this lightweight, account-free chat app.

### 🤖 AI Assistant room (private, persistent)

Unlike every other room, the AI Assistant room is **not** a shared space:

- It's a permanent system room (like Global) that shows up in everyone's
  room list, but messages inside it are **never broadcast** — the server
  only ever `socket.emit`s to the sender's own socket, so two users "in"
  the AI room never see each other's conversation.
- **First visit:** the AI greets you and asks what to call you. Your next
  message is parsed (via `server/utils/nameExtractor.js`, handling
  replies like "My name is Sami" or just "Sami") and stored as your
  preferred name in SQLite (`server/db.js`), keyed by your chat username.
- **Memory:** every user/assistant turn is saved to a `conversations`
  table. Each new AI reply is generated by sending the system prompt +
  your last 30 stored messages to OpenAI's chat completion API, so the
  model naturally recalls things you mentioned earlier (like a favorite
  team) as long as they're within that window — the same way a real
  assistant "remembers" during a conversation. This all survives server
  restarts because it's on disk, not in memory.
- **History on reopen:** every time you (re)enter the AI room, the server
  loads your saved history from SQLite and sends it back to just you via
  an `ai history` event, so the conversation picks up where you left off.
- **Voice conversation:** clicking "🎤 Start Listening" uses the browser's
  Web Speech API to turn your speech into text, which is sent through the
  exact same `chat message` pipeline as typing (with a `voiceMode: true`
  flag). If voice mode is on, the server also calls OpenAI's
  text-to-speech endpoint and sends the reply back as an audio data URL,
  which the client plays automatically (with a 🔊 speaker button on every
  AI bubble to replay/request narration on demand, and a "🔊 Mute AI"
  toggle that immediately stops playback and suppresses future auto-play).
- **Rate limiting and XSS protection apply here too** — the AI room reuses
  the same per-socket rate limiter and HTML-escaping as regular chat.

## Security Notes

- All chat text is escaped server-side (`server/utils/sanitize.js`)
  before it is ever broadcast, so no client can inject HTML/JS into
  another user's browser.
- Message length is enforced both client-side (UX) and server-side
  (authoritative).
- Rate limiting is enforced server-side per socket connection and cannot
  be bypassed by a malicious client.
- Usernames and room membership are controlled entirely server-side, so a
  client cannot spoof another user's identity, join a room it wasn't
  authorized to leave/enter, or delete a room it didn't create.
- Voice messages require microphone permission and HTTPS (or `localhost`)
  per browser security rules for `getUserMedia`. Audio is sent as a
  base64 data URL, size- and duration-capped, and rate-limited
  server-side using the same limiter as text messages — it is relayed to
  the room, never written to disk.
- Your OpenAI API key lives only in the server's environment and is never
  sent to the browser. All OpenAI calls (chat completions and
  text-to-speech) happen server-side in `server/utils/aiClient.js`.
- AI Assistant replies are HTML-escaped the same way user messages are
  before being sent to the browser, so model output can't inject markup
  either.
