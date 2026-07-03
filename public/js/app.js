(function () {
  'use strict';

  const socket = io();

  // ---- DOM references ----
  const welcomeScreenEl = document.getElementById('welcome-screen');
  const usernameFormEl = document.getElementById('username-form');
  const usernameInputEl = document.getElementById('username-input');
  const usernameErrorEl = document.getElementById('username-error');
  const usernameSubmitEl = document.getElementById('username-submit');

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
  const MAX_VOICE_DURATION_MS = 60 * 1000;
  const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
  const STORAGE_KEY = 'chat_username';
  const GLOBAL_ROOM_ID = 'global';

  let myUsername = null;
  let typingTimeout = null;
  let currentlyTypingUsers = new Set();
  let currentRoomId = null;
  let latestRooms = [];

  // Cosmetic utilities
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    typingIndicatorEl.textContent = '';
    currentlyTypingUsers = new Set();
  }

  const USER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6'];
  function colorForUsername(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
  }

  function appendChatMessage({ username, text, timestamp }) {
    const isMe = username === myUsername;
    const lastGroup = messagesEl.lastElementChild;
    const canGroup = lastGroup && lastGroup.classList.contains('message-group') && lastGroup.dataset.username === username && Date.now() - Number(lastGroup.dataset.lastTimestamp || 0) < 5 * 60 * 1000;

    if (canGroup) {
      const contentEl = lastGroup.querySelector('.message-content');
      const textEl = document.createElement('div');
      textEl.className = 'message-text';
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
    textEl.innerHTML = text;

    content.appendChild(meta);
    content.appendChild(textEl);
    group.appendChild(avatar);
    group.appendChild(content);
    messagesEl.appendChild(group);
    scrollToBottomIfNeeded();
  }

  // --- Advanced Audio Messaging Engine (With iOS Compatibility fixes) ---
  function appendVoiceMessage({ username, audio, durationMs, timestamp }) {
    const isMe = username === myUsername;
    const group = document.createElement('div');
    group.className = 'message-group';
    group.dataset.username = username;
    
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

    // Dynamic Futuristic Audio Component
    const voiceWrapper = document.createElement('div');
    voiceWrapper.className = 'voice-card';

    const playBtn = document.createElement('button');
    playBtn.className = 'voice-play-btn';
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

    const visualizer = document.createElement('div');
    visualizer.className = 'voice-visualizer';
    for (let i = 0; i < 15; i++) {
      const bar = document.createElement('div');
      bar.className = 'v-bar';
      bar.style.height = `${Math.floor(Math.random() * 16) + 4}px`;
      visualizer.appendChild(bar);
    }

    const audioEl = document.createElement('audio');
    audioEl.src = audio;

    const durationLabel = document.createElement('span');
    durationLabel.className = 'voice-duration';
    const totalSeconds = Math.round(durationMs / 1000) || 0;
    durationLabel.textContent = `0:${totalSeconds.toString().padStart(2, '0')}`;

    playBtn.addEventListener('click', () => {
      if (audioEl.paused) {
        document.querySelectorAll('audio').forEach(a => { if(a !== audioEl) a.pause(); });
        audioEl.play();
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        visualizer.classList.add('playing');
      } else {
        audioEl.pause();
      }
    });

    audioEl.addEventListener('pause', () => {
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      visualizer.classList.remove('playing');
    });

    audioEl.addEventListener('timeupdate', () => {
      const rem = Math.ceil(audioEl.duration - audioEl.currentTime) || 0;
      durationLabel.textContent = `0:${rem.toString().padStart(2, '0')}`;
    });

    audioEl.addEventListener('ended', () => {
      durationLabel.textContent = `0:${totalSeconds.toString().padStart(2, '0')}`;
    });

    voiceWrapper.appendChild(playBtn);
    voiceWrapper.appendChild(visualizer);
    voiceWrapper.appendChild(durationLabel);
    voiceWrapper.appendChild(audioEl);

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
    label.textContent = type === 'info' ? text : (type === 'join' ? `${username} joined` : `${username} left`);
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

      if (room.creatorUsername && room.creatorUsername === myUsername) {
        const del = document.createElement('button');
        del.className = 'room-delete';
        del.type = 'button';
        del.textContent = '✕';
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
    leaveRoomButtonEl.classList.toggle('hidden', currentRoomId === GLOBAL_ROOM_ID);
    deleteRoomButtonEl.classList.toggle('hidden', !(room && room.creatorUsername === myUsername));
  }

  function updateTypingIndicator() {
    const names = Array.from(currentlyTypingUsers);
    if (names.length === 0) typingIndicatorEl.textContent = '';
    else if (names.length === 1) typingIndicatorEl.textContent = `${names[0]} is typing...`;
    else if (names.length === 2) typingIndicatorEl.textContent = `${names[0]} and ${names[1]} are typing...`;
    else typingIndicatorEl.textContent = 'Several channels typing...';
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
    setTimeout(() => { composerWarningEl.textContent = ''; }, 3000);
  }

  function showRoomError(message) {
    roomErrorEl.textContent = message;
    setTimeout(() => { roomErrorEl.textContent = ''; }, 3500);
  }

  // Username connection initialization
  function showWelcomeScreen(errorMessage) {
    appEl.classList.add('hidden');
    welcomeScreenEl.classList.remove('hidden');
    if (errorMessage) usernameErrorEl.textContent = errorMessage;
    usernameSubmitEl.disabled = false;
    usernameInputEl.focus();
  }

  usernameFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = usernameInputEl.value.trim();
    if (!USERNAME_REGEX.test(value)) {
      usernameErrorEl.textContent = 'Invalid codename structure.';
      return;
    }
    usernameSubmitEl.disabled = true;
    socket.emit('set username', value);
  });

  const storedUsername = localStorage.getItem(STORAGE_KEY);
  if (storedUsername && USERNAME_REGEX.test(storedUsername)) {
    usernameInputEl.value = storedUsername;
  }

  socket.on('connect', () => {
    if (!myUsername && storedUsername && USERNAME_REGEX.test(storedUsername)) {
      socket.emit('set username', storedUsername);
    }
  });

  socket.on('username rejected', ({ reason }) => {
    localStorage.removeItem(STORAGE_KEY);
    showWelcomeScreen(reason);
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

  function sendMessage() {
    const text = messageInput.value.trim();
    if (text.length === 0) return;
    if (text.length > MAX_MESSAGE_LENGTH) return;
    socket.emit('chat message', text);
    messageInput.value = '';
    autoResizeTextarea();
    updateCharCounter();
    stopTyping();
  }

  // ---- CRITICAL FIX: Cross-Platform Universal Recording Engine ----
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
    recordingStatusEl.textContent = `Recording • ${seconds}s`;
    if (elapsedMs >= MAX_VOICE_DURATION_MS) stopRecording();
  }

  async function startRecording() {
    if (isRecording()) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showWarning('Microphone access blocked.');
      return;
    }

    audioChunks = [];
    
    // Dynamically negotiate parameters based on host device platform capabilities
    let options = {};
    if (MediaRecorder.isTypeSupported('audio/mp4')) {
      options = { mimeType: 'audio/mp4' }; // Required default target structure constraint for iOS Devices
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      options = { mimeType: 'audio/webm' }; // Standards wrapper fallbacks for classic Windows/Linux machines
    }

    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = () => {
      const durationMs = Date.now() - recordingStartTime;
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(recordingTimerInterval);
      recordingStatusEl.textContent = '';
      voiceButton.classList.remove('recording');

      if (durationMs < 400) return; // Prevent accidental misfires

      // Maintain internal container data consistency parameters during base64 conversions
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/mp4' });
      const reader = new FileReader();
      reader.onload = () => {
        socket.emit('voice message', { audio: reader.result, durationMs });
      };
      reader.readAsDataURL(blob);
    };

    recordingStartTime = Date.now();
    mediaRecorder.start();
    voiceButton.classList.add('recording');
    recordingTimerInterval = setInterval(updateRecordingStatus, 500);
  }

  function stopRecording() { if (isRecording()) mediaRecorder.stop(); }

  voiceButton.addEventListener('click', () => { if (isRecording()) stopRecording(); else startRecording(); });

  // Typing & UI events
  function notifyTyping() {
    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
  }
  function stopTyping() { clearTimeout(typingTimeout); socket.emit('stop typing'); }

  messageInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateCharCounter();
    if (messageInput.value.trim().length > 0) notifyTyping(); else stopTyping();
  });

  messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  sendButton.addEventListener('click', sendMessage);

  if (menuToggle) menuToggle.addEventListener('click', () => { sidebar.classList.toggle('open'); sidebarOverlay.classList.toggle('visible'); });
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('visible'); });

  newRoomToggle.addEventListener('click', () => {
    createRoomFormEl.classList.toggle('hidden');
    if (!createRoomFormEl.classList.contains('hidden')) roomNameInputEl.focus();
  });

  createRoomFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = roomNameInputEl.value.trim();
    if (name.length > 0) socket.emit('create room', name);
  });

  leaveRoomButtonEl.addEventListener('click', () => { socket.emit('leave room'); });
  deleteRoomButtonEl.addEventListener('click', () => { if (currentRoomId !== GLOBAL_ROOM_ID) socket.emit('delete room', currentRoomId); });

  // Socket routing pipelines
  socket.on('chat message', (payload) => { if (payload.roomId === currentRoomId) appendChatMessage(payload); });
  socket.on('voice message', (payload) => { if (payload.roomId === currentRoomId) appendVoiceMessage(payload); });
  socket.on('system message', (payload) => { if (payload.roomId === currentRoomId) appendSystemMessage(payload); });
  socket.on('online count', (count) => { onlineCountText.textContent = `${count} online`; });
  socket.on('room list', (rooms) => { renderRoomList(rooms); });
  socket.on('room user list', ({ roomId, usernames }) => { if (roomId === currentRoomId) renderUserList(usernames); });
  socket.on('room joined', ({ roomId }) => { currentRoomId = roomId; clearMessages(); renderRoomList(latestRooms); });
  socket.on('room deleted', ({ redirectTo }) => { currentRoomId = redirectTo; clearMessages(); renderRoomList(latestRooms); showWarning('Room deleted.'); });
  socket.on('typing', ({ username }) => { if (username !== myUsername) { currentlyTypingUsers.add(username); updateTypingIndicator(); } });
  socket.on('stop typing', ({ username }) => { currentlyTypingUsers.delete(username); updateTypingIndicator(); });

  updateCharCounter();
})();
