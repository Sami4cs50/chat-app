// public/js/app.js
//
// Client-side logic: username claim screen (no accounts, just a unique
// display name persisted in localStorage), room management, and the
// real-time chat experience over Socket.IO.

(function () {
  'use strict';

  const socket = io();

  // ---- DOM references: welcome screen ----
  const welcomeScreenEl = document.getElementById('welcome-screen');
  const usernameFormEl = document.getElementById('username-form');
  const usernameInputEl = document.getElementById('username-input');
  const usernameErrorEl = document.getElementById('username-error');
  const usernameSubmitEl = document.getElementById('username-submit');

  // ---- DOM references: app shell ----
  const appEl = document.getElementById('app');
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
  const voiceButton = document.getElementById('voice-button');
  const recordingStatusEl = document.getElementById('recording-status');
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  // ---- DOM references: rooms ----
  const roomListEl = document.getElementById('room-list');
  const newRoomToggle = document.getElementById('new-room-toggle');
  const createRoomFormEl = document.getElementById('create-room-form');
  const roomNameInputEl = document.getElementById('room-name-input');
  const roomErrorEl = document.getElementById('room-error');
  const roomNameHeaderEl = document.getElementById('room-name-header');
  const leaveRoomButtonEl = document.getElementById('leave-room-button');
  const deleteRoomButtonEl = document.getElementById('delete-room-button');

  const MAX_MESSAGE_LENGTH = 500;
  const TYPING_STOP_DELAY_MS = 2000;
  const MAX_VOICE_DURATION_MS = 60 * 1000; // 60 seconds
  const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
  const STORAGE_KEY = 'chat_username';
  const GLOBAL_ROOM_ID = 'global';

  let myUsername = null;
  let typingTimeout = null;
  let currentlyTypingUsers = new Set();
  let currentRoomId = null;
  let latestRooms = [];

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function getInitials(name) {
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
    const threshold = 120;
    const distanceFromBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (distanceFromBottom < threshold) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    typingIndicatorEl.textContent = '';
    currentlyTypingUsers = new Set();
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

  function appendChatMessage({ username, text, timestamp }) {
    const isMe = username === myUsername;

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

  function appendVoiceMessage({ username, audio, durationMs, timestamp }) {
    const isMe = username === myUsername;

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

    const audioEl = document.createElement('audio');
    audioEl.className = 'voice-message-player';
    audioEl.controls = true;
    audioEl.src = audio; // base64 data URL — safe to assign directly, not HTML

    const durationLabel = document.createElement('span');
    durationLabel.className = 'voice-message-duration';
    if (durationMs) {
      const seconds = Math.round(durationMs / 1000);
      durationLabel.textContent = `${seconds}s`;
    }

    const voiceWrapper = document.createElement('div');
    voiceWrapper.className = 'voice-message';
    voiceWrapper.appendChild(audioEl);
    voiceWrapper.appendChild(durationLabel);

    content.appendChild(meta);
    content.appendChild(voiceWrapper);

    group.appendChild(avatar);
    group.appendChild(content);
    messagesEl.appendChild(group);

    scrollToBottomIfNeeded();
  }

  function appendSystemMessage({ type, username, text, timestamp }) {
    const el = document.createElement('div');
    el.className = `system-message ${type}`;

    const label = document.createElement('span');
    if (type === 'info') {
      label.textContent = text || '';
    } else {
      label.textContent =
        type === 'join' ? `${username} joined the room` : `${username} left the room`;
    }

    const time = document.createElement('span');
    time.className = 'timestamp';
    time.textContent = formatTime(timestamp);

    el.appendChild(label);
    el.appendChild(time);
    messagesEl.appendChild(el);

    scrollToBottomIfNeeded();
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

  function renderRoomList(rooms) {
    latestRooms = rooms;
    roomListEl.innerHTML = '';

    rooms.forEach((room) => {
      const li = document.createElement('li');
      li.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');
      li.dataset.roomId = room.id;

      const hash = document.createElement('span');
      hash.className = 'room-hash';
      hash.textContent = '#';

      const name = document.createElement('span');
      name.className = 'room-name';
      name.textContent = room.name;

      const count = document.createElement('span');
      count.className = 'room-count';
      count.textContent = room.onlineCount;

      li.appendChild(hash);
      li.appendChild(name);
      li.appendChild(count);

      // Only the creator sees a quick-delete control in the room list
      // (in addition to the "Delete Room" button in the header).
      if (room.creatorUsername && room.creatorUsername === myUsername) {
        const del = document.createElement('button');
        del.className = 'room-delete';
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'Delete room';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('delete room', room.id);
        });
        li.appendChild(del);
      }

      li.addEventListener('click', () => {
        if (room.id === currentRoomId) return;
        socket.emit('join room', room.id);
      });

      roomListEl.appendChild(li);
    });

    updateHeaderRoomControls();
  }

  function updateHeaderRoomControls() {
    const room = latestRooms.find((r) => r.id === currentRoomId);
    roomNameHeaderEl.textContent = room ? room.name.toLowerCase() : 'global';
    messageInput.placeholder = `Message #${room ? room.name.toLowerCase() : 'global'}`;

    const isGlobal = currentRoomId === GLOBAL_ROOM_ID;
    leaveRoomButtonEl.classList.toggle('hidden', isGlobal);

    const isCreator = room && room.creatorUsername === myUsername;
    deleteRoomButtonEl.classList.toggle('hidden', !isCreator);
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

  function showWarning(message) {
    composerWarningEl.textContent = message;
    setTimeout(() => {
      composerWarningEl.textContent = '';
    }, 3000);
  }

  function showRoomError(message) {
    roomErrorEl.textContent = message;
    setTimeout(() => {
      roomErrorEl.textContent = '';
    }, 3500);
  }

  // ---------------------------------------------------------------------
  // Username claim flow
  // ---------------------------------------------------------------------

  function showWelcomeScreen(errorMessage) {
    appEl.classList.add('hidden');
    welcomeScreenEl.classList.remove('hidden');
    if (errorMessage) {
      usernameErrorEl.textContent = errorMessage;
    }
    usernameSubmitEl.disabled = false;
    usernameInputEl.focus();
  }

  function attemptUsername(username) {
    usernameSubmitEl.disabled = true;
    socket.emit('set username', username);
  }

  usernameFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = usernameInputEl.value.trim();
    usernameErrorEl.textContent = '';

    if (!USERNAME_REGEX.test(value)) {
      usernameErrorEl.textContent =
        'Username must be 3-20 characters: letters, numbers, and underscores only.';
      return;
    }

    attemptUsername(value);
  });

  // On page load, if a username was previously saved, try to reconnect
  // with it automatically. If it's already taken (someone else is online
  // with that name), the welcome screen is shown so the user can pick a
  // different one.
  const storedUsername = localStorage.getItem(STORAGE_KEY);
  if (storedUsername && USERNAME_REGEX.test(storedUsername)) {
    usernameInputEl.value = storedUsername;
  }

  socket.on('connect', () => {
    if (!myUsername && storedUsername && USERNAME_REGEX.test(storedUsername)) {
      attemptUsername(storedUsername);
    }
  });

  socket.on('username rejected', ({ reason }) => {
    // If the stored username was rejected (e.g. already in use elsewhere),
    // clear it so we don't keep retrying it on future loads.
    localStorage.removeItem(STORAGE_KEY);
    showWelcomeScreen(reason || 'This username is already in use.');
  });

  socket.on('username accepted', ({ username, onlineCount, rooms, currentRoom }) => {
    myUsername = username;
    localStorage.setItem(STORAGE_KEY, username);

    currentUsernameEl.textContent = username;
    currentUserAvatarEl.textContent = getInitials(username);
    currentUserAvatarEl.style.background = colorForUsername(username);
    onlineCountText.textContent = `${onlineCount} online`;

    currentRoomId = currentRoom;
    renderRoomList(rooms);

    welcomeScreenEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    messageInput.focus();
  });

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

  // ---------------------------------------------------------------------
  // Voice messages
  // ---------------------------------------------------------------------

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = 0;
  let recordingTimerInterval = null;

  function isRecording() {
    return mediaRecorder && mediaRecorder.state === 'recording';
  }

  function updateRecordingStatus() {
    const elapsedMs = Date.now() - recordingStartTime;
    const seconds = Math.floor(elapsedMs / 1000);
    recordingStatusEl.textContent = `● Recording ${seconds}s`;
    if (elapsedMs >= MAX_VOICE_DURATION_MS) {
      stopRecording();
    }
  }

  async function startRecording() {
    if (isRecording()) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showWarning('Microphone access was denied or is unavailable.');
      return;
    }

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const durationMs = Date.now() - recordingStartTime;
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(recordingTimerInterval);
      recordingStatusEl.textContent = '';
      voiceButton.classList.remove('recording');

      if (durationMs < 300) return; // ignore accidental taps

      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        socket.emit('voice message', {
          audio: reader.result, // base64 data URL
          durationMs,
        });
      };
      reader.readAsDataURL(blob);
    };

    recordingStartTime = Date.now();
    mediaRecorder.start();
    voiceButton.classList.add('recording');
    updateRecordingStatus();
    recordingTimerInterval = setInterval(updateRecordingStatus, 500);
  }

  function stopRecording() {
    if (isRecording()) {
      mediaRecorder.stop();
    }
  }

  voiceButton.addEventListener('click', () => {
    if (isRecording()) {
      stopRecording();
    } else {
      startRecording();
    }
  });

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
  // Event listeners: composer
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
  // Event listeners: rooms
  // ---------------------------------------------------------------------

  newRoomToggle.addEventListener('click', () => {
    createRoomFormEl.classList.toggle('hidden');
    if (!createRoomFormEl.classList.contains('hidden')) {
      roomNameInputEl.focus();
    }
  });

  createRoomFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = roomNameInputEl.value.trim();
    if (name.length < 1 || name.length > 30) {
      showRoomError('Room name must be 1-30 characters.');
      return;
    }
    socket.emit('create room', name);
  });

  leaveRoomButtonEl.addEventListener('click', () => {
    socket.emit('leave room');
  });

  deleteRoomButtonEl.addEventListener('click', () => {
    if (!currentRoomId || currentRoomId === GLOBAL_ROOM_ID) return;
    socket.emit('delete room', currentRoomId);
  });

  // ---------------------------------------------------------------------
  // Socket.IO event handlers: chat + presence
  // ---------------------------------------------------------------------

  socket.on('chat message', (payload) => {
    if (payload.roomId && payload.roomId !== currentRoomId) return;
    appendChatMessage(payload);
  });

  socket.on('voice message', (payload) => {
    if (payload.roomId && payload.roomId !== currentRoomId) return;
    appendVoiceMessage(payload);
  });

  socket.on('system message', (payload) => {
    if (payload.roomId && payload.roomId !== currentRoomId) return;
    appendSystemMessage(payload);
  });

  socket.on('online count', (count) => {
    onlineCountText.textContent = `${count} online`;
  });

  socket.on('room list', (rooms) => {
    renderRoomList(rooms);
  });

  socket.on('room user list', ({ roomId, usernames }) => {
    if (roomId !== currentRoomId) return;
    renderUserList(usernames);
  });

  socket.on('room joined', ({ roomId }) => {
    currentRoomId = roomId;
    clearMessages();
    roomNameInputEl.value = '';
    createRoomFormEl.classList.add('hidden');
    renderRoomList(latestRooms);
  });

  socket.on('room deleted', ({ redirectTo }) => {
    currentRoomId = redirectTo;
    clearMessages();
    renderRoomList(latestRooms);
    showWarning('That room was deleted. You have been moved to Global.');
  });

  socket.on('room error', ({ reason }) => {
    showRoomError(reason || 'Something went wrong with that room action.');
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

  // Initialize UI state.
  updateCharCounter();
  if (!storedUsername) {
    usernameInputEl.focus();
  }
})();
