// public/js/app.js
//
// Client-side logic: connects to the Socket.IO server, renders messages,
// handles typing indicators, join/leave notices, online count, and
// enforces the same UX rules the server enforces (message length, etc).

(function () {
  'use strict';

  const socket = io();

  // ---- DOM references ----
  const messagesEl = document.getElementById('messages');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const onlineCountText = document.getElementById('online-count-text');
  const userListEl = document.getElementById('user-list');
  const currentUsernameEl = document.getElementById('current-username');
  const currentUserAvatarEl = document.getElementById('current-user-avatar');
  const typingIndicatorEl = document.getElementById('typing-indicator');
  const charCounterEl = document.getElementById('char-counter');
  const composerWarningEl = document.getElementById('composer-warning');
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  const MAX_MESSAGE_LENGTH = 500;
  const TYPING_STOP_DELAY_MS = 2000;

  let myUsername = null;
  let typingTimeout = null;
  let currentlyTypingUsers = new Set();

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function getInitials(name) {
    // Grab the first uppercase-leading chunk for a compact avatar glyph.
    const match = name.match(/^[A-Z][a-z]*/);
    return (match ? match[0] : name).slice(0, 2).toUpperCase();
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  function scrollToBottomIfNeeded() {
    // Only auto-scroll if the user is already near the bottom, so we don't
    // yank them away from history they're reading.
    const threshold = 120;
    const distanceFromBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (distanceFromBottom < threshold) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function appendChatMessage({ username, text, timestamp }) {
    const isMe = username === myUsername;

    // Group consecutive messages from the same author (Discord-style).
    const lastGroup = messagesEl.lastElementChild;
    const canGroup =
      lastGroup &&
      lastGroup.classList.contains('message-group') &&
      lastGroup.dataset.username === username &&
      Date.now() - Number(lastGroup.dataset.lastTimestamp || 0) < 5 * 60 * 1000;

    if (canGroup) {
      const contentEl = lastGroup.querySelector('.message-content');
      const textEl = document.createElement('div');
      textEl.className = 'message-text';
      // Server already escaped the text; innerHTML is safe here because the
      // payload only ever contains escaped entities, never raw markup.
      textEl.innerHTML = text;
      contentEl.appendChild(textEl);
      lastGroup.dataset.lastTimestamp = String(timestamp);
      scrollToBottomIfNeeded();
      return;
    }

    const group = document.createElement('div');
    group.className = 'message-group';
    group.dataset.username = username;
    group.dataset.lastTimestamp = String(timestamp);

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = getInitials(username);
    avatar.style.background = colorForUsername(username);

    const content = document.createElement('div');
    content.className = 'message-content';

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = username + (isMe ? ' (you)' : '');
    author.style.color = colorForUsername(username);

    const time = document.createElement('span');
    time.className = 'message-timestamp';
    time.textContent = formatTime(timestamp);

    meta.appendChild(author);
    meta.appendChild(time);

    const textEl = document.createElement('div');
    textEl.className = 'message-text';
    textEl.innerHTML = text; // already escaped server-side

    content.appendChild(meta);
    content.appendChild(textEl);

    group.appendChild(avatar);
    group.appendChild(content);
    messagesEl.appendChild(group);

    scrollToBottomIfNeeded();
  }

  function appendSystemMessage({ type, username, timestamp }) {
    const el = document.createElement('div');
    el.className = `system-message ${type}`;

    const text = document.createElement('span');
    text.textContent =
      type === 'join' ? `${username} joined the chat` : `${username} left the chat`;

    const time = document.createElement('span');
    time.className = 'timestamp';
    time.textContent = formatTime(timestamp);

    el.appendChild(text);
    el.appendChild(time);
    messagesEl.appendChild(el);

    scrollToBottomIfNeeded();
  }

  // Deterministic pastel-ish color per username, purely cosmetic.
  const USER_COLORS = [
    '#5865f2', '#eb459e', '#faa61a', '#3ba55c',
    '#ed4245', '#00b0f4', '#9b59b6', '#f1c40f',
  ];
  function colorForUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
  }

  function renderUserList(usernames) {
    userListEl.innerHTML = '';
    usernames.forEach((name) => {
      const li = document.createElement('li');

      const miniAvatar = document.createElement('span');
      miniAvatar.className = 'mini-avatar';
      miniAvatar.textContent = getInitials(name);
      miniAvatar.style.background = colorForUsername(name);

      const label = document.createElement('span');
      label.textContent = name === myUsername ? `${name} (you)` : name;

      li.appendChild(miniAvatar);
      li.appendChild(label);
      userListEl.appendChild(li);
    });
  }

  function updateTypingIndicator() {
    const names = Array.from(currentlyTypingUsers);
    if (names.length === 0) {
      typingIndicatorEl.textContent = '';
    } else if (names.length === 1) {
      typingIndicatorEl.textContent = `${names[0]} is typing...`;
    } else if (names.length === 2) {
      typingIndicatorEl.textContent = `${names[0]} and ${names[1]} are typing...`;
    } else {
      typingIndicatorEl.textContent = 'Several people are typing...';
    }
  }

  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  }

  function updateCharCounter() {
    const len = messageInput.value.length;
    charCounterEl.textContent = `${len} / ${MAX_MESSAGE_LENGTH}`;
    charCounterEl.style.color = len >= MAX_MESSAGE_LENGTH ? 'var(--danger)' : '';
  }

  // ---------------------------------------------------------------------
  // Sending messages
  // ---------------------------------------------------------------------

  function sendMessage() {
    const text = messageInput.value;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      showWarning(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }

    socket.emit('chat message', trimmed);
    messageInput.value = '';
    autoResizeTextarea();
    updateCharCounter();
    stopTyping();
  }

  function showWarning(message) {
    composerWarningEl.textContent = message;
    setTimeout(() => {
      composerWarningEl.textContent = '';
    }, 3000);
  }

  // ---------------------------------------------------------------------
  // Typing detection
  // ---------------------------------------------------------------------

  function notifyTyping() {
    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
  }

  function stopTyping() {
    clearTimeout(typingTimeout);
    socket.emit('stop typing');
  }

  // ---------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------

  messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateCharCounter();
    if (messageInput.value.trim().length > 0) {
      notifyTyping();
    } else {
      stopTyping();
    }
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Shift+Enter falls through and inserts a newline naturally.
  });

  sendButton.addEventListener('click', sendMessage);

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('visible');
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
    });
  }

  // ---------------------------------------------------------------------
  // Socket.IO event handlers
  // ---------------------------------------------------------------------

  socket.on('welcome', ({ username, onlineCount }) => {
    myUsername = username;
    currentUsernameEl.textContent = username;
    currentUserAvatarEl.textContent = getInitials(username);
    currentUserAvatarEl.style.background = colorForUsername(username);
    onlineCountText.textContent = `${onlineCount} online`;
  });

  socket.on('chat message', (payload) => {
    appendChatMessage(payload);
  });

  socket.on('system message', (payload) => {
    appendSystemMessage(payload);
  });

  socket.on('online count', (count) => {
    onlineCountText.textContent = `${count} online`;
  });

  socket.on('user list', (usernames) => {
    renderUserList(usernames);
  });

  socket.on('typing', ({ username }) => {
    if (username === myUsername) return;
    currentlyTypingUsers.add(username);
    updateTypingIndicator();
  });

  socket.on('stop typing', ({ username }) => {
    currentlyTypingUsers.delete(username);
    updateTypingIndicator();
  });

  socket.on('rate limited', ({ mutedMsRemaining }) => {
    const seconds = Math.ceil((mutedMsRemaining || 0) / 1000);
    showWarning(
      seconds > 0
        ? `You're sending messages too fast. Try again in ${seconds}s.`
        : "You're sending messages too fast. Slow down a bit."
    );
  });

  socket.on('message error', ({ reason }) => {
    showWarning(reason || 'Message could not be sent.');
  });

  socket.on('disconnect', () => {
    onlineCountText.textContent = 'Reconnecting...';
  });

  socket.on('connect', () => {
    // On reconnect, the server will re-send 'welcome' with a fresh username
    // since state is in-memory and tied to the socket connection.
  });

  // Initialize UI state.
  updateCharCounter();
  messageInput.focus();
})();
