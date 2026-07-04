// public/js/app.js
//
// Client-side logic: username claim screen, room management, real-time
// chat over Socket.IO, an advanced press-and-hold voice-message recorder,
// and the private 🤖 AI Assistant room (text + voice conversation with
// OpenAI, browser speech-to-text, and TTS playback).

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
  const chatMainEl = document.getElementById('chat-main');
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
  const composerBoxEl = document.getElementById('composer-box');
  const voiceButton = document.getElementById('voice-button');
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const roomHashIconEl = document.getElementById('room-hash-icon');

  // ---- DOM references: rooms ----
  const roomListEl = document.getElementById('room-list');
  const newRoomToggle = document.getElementById('new-room-toggle');
  const createRoomFormEl = document.getElementById('create-room-form');
  const roomNameInputEl = document.getElementById('room-name-input');
  const roomErrorEl = document.getElementById('room-error');
  const roomNameHeaderEl = document.getElementById('room-name-header');
  const leaveRoomButtonEl = document.getElementById('leave-room-button');
  const deleteRoomButtonEl = document.getElementById('delete-room-button');

  // ---- DOM references: voice MESSAGE recording bar (regular rooms) ----
  const recordingBarEl = document.getElementById('recording-bar');
  const cancelRecordingBtn = document.getElementById('cancel-recording-btn');
  const recordingTimerEl = document.getElementById('recording-timer');
  const recordingWaveformCanvas = document.getElementById('recording-waveform');
  const slideToCancelEl = document.getElementById('slide-to-cancel');
  const lockIndicatorEl = document.getElementById('lock-indicator');
  const lockedActionsEl = document.getElementById('locked-actions');
  const lockedCancelBtn = document.getElementById('locked-cancel-btn');
  const lockedSendBtn = document.getElementById('locked-send-btn');

  // ---- DOM references: AI Assistant voice conversation bar ----
  const aiVoiceBarEl = document.getElementById('ai-voice-bar');
  const aiStartListeningBtn = document.getElementById('ai-start-listening-btn');
  const aiStopListeningBtn = document.getElementById('ai-stop-listening-btn');
  const aiSpeakingWaveEl = document.getElementById('ai-speaking-wave');
  const aiMuteBtn = document.getElementById('ai-mute-btn');
  const aiMuteIcon = document.getElementById('ai-mute-icon');
  const aiMuteLabel = document.getElementById('ai-mute-label');

  const MAX_MESSAGE_LENGTH = 500;
  const TYPING_STOP_DELAY_MS = 2000;
  const MAX_VOICE_DURATION_MS = 60 * 1000; // 60 seconds
  const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;
  const STORAGE_KEY = 'chat_username';
  const GLOBAL_ROOM_ID = 'global';
  const AI_ROOM_ID = 'ai-assistant';
  const CANCEL_DRAG_THRESHOLD = 80; // px, slide-left-to-cancel
  const LOCK_DRAG_THRESHOLD = 60; // px, slide-up-to-lock

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

  // ---------------------------------------------------------------------
  // Message rendering (regular chat + AI Assistant bubbles)
  // ---------------------------------------------------------------------

  function createSpeakButton(rawText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-speak-btn';
    btn.title = 'Play this reply out loud';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5z"/></svg>';
    btn.addEventListener('click', () => {
      if (!rawText) return;
      if (aiMuted) {
        showWarning('AI voice is muted. Unmute to hear replies.');
        return;
      }
      pendingSpeakBtn = btn;
      socket.emit('ai tts request', { text: rawText });
    });
    return btn;
  }

  function appendChatMessage({ username, text, rawText, isAI, audio, timestamp }) {
    const isMe = !isAI && username === myUsername;

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

      if (isAI) {
        const row = document.createElement('div');
        row.className = 'ai-message-row';
        const speakBtn = createSpeakButton(rawText || '');
        row.appendChild(speakBtn);
        contentEl.appendChild(row);
        if (audio) playAiAudio(audio, speakBtn);
      }

      lastGroup.dataset.lastTimestamp = String(timestamp);
      scrollToBottomIfNeeded();
      return;
    }

    const group = document.createElement('div');
    group.className = 'message-group' + (isAI ? ' ai-message' : '');
    group.dataset.username = username;
    group.dataset.lastTimestamp = String(timestamp);

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    if (isAI) {
      avatar.textContent = '🤖';
    } else {
      avatar.textContent = getInitials(username);
      avatar.style.background = colorForUsername(username);
    }

    const content = document.createElement('div');
    content.className = 'message-content';

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = isAI ? username : username + (isMe ? ' (you)' : '');
    if (!isAI) author.style.color = colorForUsername(username);

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

    if (isAI) {
      const row = document.createElement('div');
      row.className = 'ai-message-row';
      const speakBtn = createSpeakButton(rawText || '');
      row.appendChild(speakBtn);
      content.appendChild(row);
      if (audio) playAiAudio(audio, speakBtn);
    }

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

  function showAiThinking() {
    hideAiThinking();
    const el = document.createElement('div');
    el.id = 'ai-thinking-bubble';
    el.className = 'ai-thinking-bubble';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = '🤖';

    const dots = document.createElement('div');
    dots.className = 'ai-thinking-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';

    el.appendChild(avatar);
    el.appendChild(dots);
    messagesEl.appendChild(el);
    scrollToBottomIfNeeded();
  }

  function hideAiThinking() {
    const el = document.getElementById('ai-thinking-bubble');
    if (el) el.remove();
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
      hash.textContent = room.isAI ? '🤖' : '#';

      const name = document.createElement('span');
      name.className = 'room-name';
      name.textContent = room.isAI ? room.name.replace(/^🤖\s*/, '') : room.name;

      const count = document.createElement('span');
      count.className = 'room-count';
      count.textContent = room.onlineCount;

      li.appendChild(hash);
      li.appendChild(name);
      li.appendChild(count);

      // Only the creator sees a quick-delete control (system rooms like
      // Global and the AI Assistant have no creator, so never show one).
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
    const isAiRoom = currentRoomId === AI_ROOM_ID;

    roomNameHeaderEl.textContent = isAiRoom
      ? 'AI Assistant'
      : room
      ? room.name.toLowerCase()
      : 'global';
    roomHashIconEl.textContent = isAiRoom ? '🤖' : '#';
    roomHashIconEl.classList.toggle('ai-icon', isAiRoom);

    messageInput.placeholder = isAiRoom
      ? 'Message the AI Assistant, or use voice below...'
      : `Message #${room ? room.name.toLowerCase() : 'global'}`;

    const isGlobal = currentRoomId === GLOBAL_ROOM_ID;
    leaveRoomButtonEl.classList.toggle('hidden', isGlobal);

    const isCreator = room && room.creatorUsername === myUsername;
    deleteRoomButtonEl.classList.toggle('hidden', !isCreator);

    chatMainEl.classList.toggle('ai-room-active', isAiRoom);
    aiVoiceBarEl.classList.toggle('hidden', !isAiRoom);
    voiceButton.classList.toggle('hidden', isAiRoom);

    if (!isAiRoom) {
      stopListening();
      stopAiAudioPlayback();
      hideAiThinking();
    }
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

  function sendMessage(options) {
    const opts = options || {};
    const usingOverride = typeof opts.textOverride === 'string';
    const text = usingOverride ? opts.textOverride : messageInput.value;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      showWarning(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }

    socket.emit('chat message', { text: trimmed, voiceMode: opts.voiceMode === true });

    if (!usingOverride) {
      messageInput.value = '';
      autoResizeTextarea();
      updateCharCounter();
    }
    stopTyping();
  }

  // ---------------------------------------------------------------------
  // Typing detection (regular rooms only — the AI room has its own
  // server-driven "thinking" indicator instead of peer-typing)
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
    if (currentRoomId === AI_ROOM_ID) return;
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

  sendButton.addEventListener('click', () => sendMessage());

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

  // =======================================================================
  // Advanced voice MESSAGE recording (regular rooms) — press and hold the
  // mic to record, slide left to cancel, slide up to lock hands-free.
  // =======================================================================

  const RECORDING_SUPPORTED = !!(
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );

  if (!RECORDING_SUPPORTED) {
    voiceButton.disabled = true;
    voiceButton.title = 'Voice messages are not supported on this browser.';
  }

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStream = null;
  let recordingStartTime = 0;
  let recordingTimerInterval = null;
  let recordingCanceled = false;
  let recordingLocked = false;
  let dragActive = false;
  let pointerStartX = 0;
  let pointerStartY = 0;

  let waveformAudioCtx = null;
  let waveformAnalyser = null;
  let waveformRafId = null;

  function isRecording() {
    return mediaRecorder && mediaRecorder.state === 'recording';
  }

  function pickVoiceMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    // iOS Safari only supports mp4/aac; Chrome/Firefox/Android support
    // webm/opus. Trying each in order picks whatever the browser can do.
    const candidates = [
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function updateRecordingTimer() {
    const elapsedMs = Date.now() - recordingStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    recordingTimerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (elapsedMs >= MAX_VOICE_DURATION_MS) {
      stopRecordingAndSend();
    }
  }

  function startWaveformVisualizer(stream) {
    try {
      waveformAudioCtx =
        waveformAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (waveformAudioCtx.state === 'suspended') waveformAudioCtx.resume();

      const source = waveformAudioCtx.createMediaStreamSource(stream);
      waveformAnalyser = waveformAudioCtx.createAnalyser();
      waveformAnalyser.fftSize = 256;
      source.connect(waveformAnalyser);

      const canvasCtx = recordingWaveformCanvas.getContext('2d');
      const bufferLength = waveformAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        waveformRafId = requestAnimationFrame(draw);
        waveformAnalyser.getByteTimeDomainData(dataArray);

        const width = recordingWaveformCanvas.width;
        const height = recordingWaveformCanvas.height;
        canvasCtx.clearRect(0, 0, width, height);
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = recordingCanceled ? '#f23f42' : '#8b5cf6';
        canvasCtx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) canvasCtx.moveTo(x, y);
          else canvasCtx.lineTo(x, y);
          x += sliceWidth;
        }
        canvasCtx.lineTo(width, height / 2);
        canvasCtx.stroke();
      };
      draw();
    } catch (err) {
      // Purely cosmetic — recording still works fine without a waveform.
    }
  }

  function stopWaveformVisualizer() {
    if (waveformRafId) cancelAnimationFrame(waveformRafId);
    waveformRafId = null;
    if (waveformAnalyser) {
      try {
        waveformAnalyser.disconnect();
      } catch (err) {
        /* no-op */
      }
    }
    waveformAnalyser = null;
  }

  async function beginRecording() {
    if (!RECORDING_SUPPORTED || isRecording()) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showWarning('Microphone access was denied or is unavailable.');
      dragActive = false;
      voiceButton.classList.remove('armed');
      return;
    }

    recordingStream = stream;
    audioChunks = [];
    recordingCanceled = false;
    recordingLocked = false;

    const mimeType = pickVoiceMimeType();
    try {
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = finishRecording;

    recordingStartTime = Date.now();
    mediaRecorder.start();

    recordingBarEl.classList.remove('hidden');
    recordingBarEl.classList.remove('canceling');
    composerBoxEl.classList.add('hidden');
    lockedActionsEl.classList.add('hidden');
    lockIndicatorEl.classList.remove('pulling');
    slideToCancelEl.style.opacity = '1';

    updateRecordingTimer();
    recordingTimerInterval = setInterval(updateRecordingTimer, 200);

    startWaveformVisualizer(stream);
  }

  function finishRecording() {
    stopWaveformVisualizer();
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;

    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }

    recordingBarEl.classList.add('hidden');
    recordingBarEl.classList.remove('canceling');
    composerBoxEl.classList.remove('hidden');
    lockedActionsEl.classList.add('hidden');

    const durationMs = Date.now() - recordingStartTime;
    const wasCanceled = recordingCanceled;
    recordingCanceled = false;
    recordingLocked = false;

    if (wasCanceled || durationMs < 300 || audioChunks.length === 0) {
      audioChunks = [];
      return;
    }

    const blob = new Blob(audioChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
    audioChunks = [];

    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('voice message', { audio: reader.result, durationMs });
    };
    reader.readAsDataURL(blob);
  }

  function stopRecordingAndSend() {
    if (isRecording()) mediaRecorder.stop();
  }

  function cancelRecording() {
    recordingCanceled = true;
    if (isRecording()) mediaRecorder.stop();
  }

  voiceButton.addEventListener('pointerdown', (e) => {
    if (!RECORDING_SUPPORTED) {
      showWarning('Voice messages are not supported on this browser.');
      return;
    }
    e.preventDefault();
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    dragActive = true;
    voiceButton.classList.add('armed');
    beginRecording();
    if (voiceButton.setPointerCapture) {
      try {
        voiceButton.setPointerCapture(e.pointerId);
      } catch (err) {
        /* no-op */
      }
    }
  });

  voiceButton.addEventListener('pointermove', (e) => {
    if (!dragActive || !isRecording() || recordingLocked) return;
    const deltaX = e.clientX - pointerStartX;
    const deltaY = e.clientY - pointerStartY;

    if (deltaX < -CANCEL_DRAG_THRESHOLD) {
      if (!recordingCanceled) {
        recordingCanceled = true;
        recordingBarEl.classList.add('canceling');
      }
    } else if (recordingCanceled) {
      recordingCanceled = false;
      recordingBarEl.classList.remove('canceling');
    }
    slideToCancelEl.style.opacity = String(
      Math.max(0, 1 - Math.abs(deltaX) / CANCEL_DRAG_THRESHOLD)
    );

    lockIndicatorEl.classList.toggle('pulling', deltaY < -LOCK_DRAG_THRESHOLD);
  });

  function endPointerGesture(e) {
    if (!dragActive) return;
    dragActive = false;
    voiceButton.classList.remove('armed');

    if (!isRecording()) return;

    const deltaX = e.clientX - pointerStartX;
    const deltaY = e.clientY - pointerStartY;

    if (deltaY < -LOCK_DRAG_THRESHOLD && !recordingCanceled) {
      recordingLocked = true;
      lockIndicatorEl.classList.remove('pulling');
      lockedActionsEl.classList.remove('hidden');
      slideToCancelEl.style.opacity = '0';
      return;
    }

    if (deltaX < -CANCEL_DRAG_THRESHOLD || recordingCanceled) {
      cancelRecording();
      return;
    }

    stopRecordingAndSend();
  }

  voiceButton.addEventListener('pointerup', endPointerGesture);
  voiceButton.addEventListener('pointercancel', endPointerGesture);

  cancelRecordingBtn.addEventListener('click', () => cancelRecording());
  lockedCancelBtn.addEventListener('click', () => cancelRecording());
  lockedSendBtn.addEventListener('click', () => stopRecordingAndSend());

  // =======================================================================
  // 🤖 AI Assistant room: speech-to-text (Web Speech API) + TTS playback
  // =======================================================================

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const SPEECH_RECOGNITION_SUPPORTED = !!SpeechRecognitionImpl;

  if (!SPEECH_RECOGNITION_SUPPORTED) {
    aiStartListeningBtn.disabled = true;
    aiStartListeningBtn.title =
      'Speech recognition is not supported in this browser (try Chrome, Edge, or Safari).';
  }

  let recognizer = null;
  let isListening = false;
  let aiMuted = false;
  let currentAiAudio = null;
  let pendingSpeakBtn = null;

  function startListening() {
    if (!SPEECH_RECOGNITION_SUPPORTED || currentRoomId !== AI_ROOM_ID || isListening) return;

    recognizer = new SpeechRecognitionImpl();
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    recognizer.continuous = false;

    recognizer.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) {
        sendMessage({ textOverride: transcript, voiceMode: true });
      }
    };

    recognizer.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        showWarning('Could not hear you clearly. Please try again.');
      }
    };

    recognizer.onend = () => {
      stopListening();
    };

    try {
      recognizer.start();
    } catch (err) {
      showWarning('Microphone could not be started.');
      return;
    }

    isListening = true;
    aiStartListeningBtn.classList.add('hidden');
    aiStopListeningBtn.classList.remove('hidden');
    aiStopListeningBtn.classList.add('listening');
  }

  function stopListening() {
    if (recognizer) {
      try {
        recognizer.stop();
      } catch (err) {
        /* no-op */
      }
    }
    isListening = false;
    aiStartListeningBtn.classList.remove('hidden');
    aiStopListeningBtn.classList.add('hidden');
    aiStopListeningBtn.classList.remove('listening');
  }

  aiStartListeningBtn.addEventListener('click', startListening);
  aiStopListeningBtn.addEventListener('click', stopListening);

  function showSpeakingWave() {
    aiSpeakingWaveEl.classList.remove('hidden');
  }

  function hideSpeakingWave() {
    aiSpeakingWaveEl.classList.add('hidden');
  }

  function stopAiAudioPlayback() {
    if (currentAiAudio) {
      currentAiAudio.pause();
      currentAiAudio.currentTime = 0;
      currentAiAudio = null;
    }
    hideSpeakingWave();
  }

  function playAiAudio(dataUrl, speakBtnEl) {
    if (aiMuted) return;
    stopAiAudioPlayback(); // only one AI voice plays at a time

    const audioEl = new Audio(dataUrl);
    currentAiAudio = audioEl;

    audioEl.addEventListener('play', () => {
      showSpeakingWave();
      if (speakBtnEl) speakBtnEl.classList.add('speaking');
    });
    const clearSpeakingState = () => {
      hideSpeakingWave();
      if (speakBtnEl) speakBtnEl.classList.remove('speaking');
      if (currentAiAudio === audioEl) currentAiAudio = null;
    };
    audioEl.addEventListener('ended', clearSpeakingState);
    audioEl.addEventListener('pause', clearSpeakingState);

    audioEl.play().catch(() => {
      // Autoplay was blocked by the browser — the message's speaker button
      // remains available as a manual, always-works fallback.
      clearSpeakingState();
    });
  }

  aiMuteBtn.addEventListener('click', () => {
    aiMuted = !aiMuted;
    aiMuteBtn.setAttribute('aria-pressed', String(aiMuted));
    aiMuteIcon.textContent = aiMuted ? '🔇' : '🔊';
    aiMuteLabel.textContent = aiMuted ? 'Unmute AI' : 'Mute AI';
    if (aiMuted) {
      // "Voice playback should automatically stop when muted."
      stopAiAudioPlayback();
    }
  });

  socket.on('ai tts result', ({ audio }) => {
    playAiAudio(audio, pendingSpeakBtn);
    pendingSpeakBtn = null;
  });

  socket.on('ai typing', ({ typing }) => {
    if (currentRoomId !== AI_ROOM_ID) return;
    if (typing) showAiThinking();
    else hideAiThinking();
  });

  socket.on('ai history', ({ preferredName, messages }) => {
    if (currentRoomId !== AI_ROOM_ID) return;
    clearMessages();
    messages.forEach((m) => {
      if (m.role === 'user') {
        appendChatMessage({ username: myUsername, text: m.text, timestamp: m.timestamp });
      } else {
        appendChatMessage({
          username: 'AI Assistant',
          text: m.text,
          rawText: m.rawText,
          isAI: true,
          timestamp: m.timestamp,
        });
      }
    });
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
    if (roomId !== AI_ROOM_ID) {
      // The AI room renders itself from the 'ai history' event instead,
      // to avoid a flash of an empty room before history arrives.
      clearMessages();
    }
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
    stopListening();
    stopAiAudioPlayback();
  });

  // Initialize UI state.
  updateCharCounter();
  if (!storedUsername) {
    usernameInputEl.focus();
  }
})();
