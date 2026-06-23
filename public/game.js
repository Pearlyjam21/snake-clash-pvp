// JavaScript coding-structure notes for this file:
// - Variables/constants: `const` and `let` store values used by the program. This code does not use old-style `var`.
// - Functions: `function name(...) { ... }` groups reusable actions, such as drawing the board or formatting text.
// - Condition structure: `if / else if / else` chooses which code runs based on the current game state.
// - Repetition structure: `for` loops and `.forEach(...)` repeat code for players, grid lines, snake segments, and options.
// - Event handlers: `socket.on(...)`, `addEventListener(...)`, and callbacks run later when the server or user triggers them.

// `const` declares a constant variable reference. `socket` connects this browser to the Socket.io server.
const socket = io();


// DOM element variables: each `const` stores one HTML element so the code can update the page without searching again.
const joinPanel = document.getElementById('joinPanel');
const gamePanel = document.getElementById('gamePanel');
const joinForm = document.getElementById('joinForm');
const joinError = document.getElementById('joinError');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const connectionStatus = document.getElementById('connectionStatus');
const roomLabel = document.getElementById('roomLabel');
const gameMessage = document.getElementById('gameMessage');
const scoreboard = document.getElementById('scoreboard');
const waitingScreen = document.getElementById('waitingScreen');
const restartButton = document.getElementById('restartButton');
const overlayRestartButton = document.getElementById('overlayRestartButton');
const winnerOverlay = document.getElementById('winnerOverlay');
const winnerTitle = document.getElementById('winnerTitle');
const winnerText = document.getElementById('winnerText');
const triviaOverlay = document.getElementById('triviaOverlay');
const triviaQuestion = document.getElementById('triviaQuestion');
const triviaOptions = document.getElementById('triviaOptions');
const triviaTimer = document.getElementById('triviaTimer');
const triviaResult = document.getElementById('triviaResult');
const triviaTimerBar = document.getElementById('triviaTimerBar');
const canvas = document.getElementById('gameCanvas');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownText = document.getElementById('countdownText');
const countdownNumber = document.getElementById('countdownNumber');
const mobileControlButtons = document.querySelectorAll('[data-direction]');
const ctx = canvas.getContext('2d');

// `let` declares variables whose values can change while the game runs.
let myPlayerId = null;
let latestState = null;
let previousLives = new Map(); //store key and value player1,2
const damagedPlayers = new Set();

// Socket event handlers: these callback functions run when the server sends a named event.
socket.on('connect', () => { connectionStatus.textContent = 'Connected'; connectionStatus.classList.add('online'); });
socket.on('disconnect', () => { connectionStatus.textContent = 'Disconnected'; connectionStatus.classList.remove('online'); });
socket.on('joined', ({ playerId, roomCode }) => { myPlayerId = playerId; roomLabel.textContent = roomCode; document.body.classList.add('in-game'); joinPanel.classList.add('hidden'); gamePanel.classList.remove('hidden'); joinError.textContent = ''; });
socket.on('joinError', (message) => { joinError.textContent = message; });
socket.on('gameState', (state) => {
  // Function calls: reuse named logic instead of repeating the same code here.
  markLifeLosses(state);
  latestState = state;
  renderState(state);
});

// Trivia state variables: `let` is used because the active question/timers change over time.
let activeTrivia = null;
let triviaTimerInterval = null;
let triviaHideTimeout = null;

socket.on('triviaQuestion', (data) => {
  clearInterval(triviaTimerInterval);
  clearTimeout(triviaHideTimeout);
  activeTrivia = {
    questionId: data.questionId,
    timeLimit: data.timeLimit, //calling time limit inside of active trivia (function input)
    _startMs: Date.now(),
    selectedLabel: null
  };
  // Repetition by timer: `setInterval` repeats this callback every 100 milliseconds until cleared.
  triviaTimerInterval = setInterval(() => {
    // Condition structure: if no trivia is active, stop the timer and exit this callback early.
    if (!activeTrivia) { clearInterval(triviaTimerInterval); return; }
    const elapsed = (Date.now() - activeTrivia._startMs) / 1000;
    const remaining = Math.max(0, activeTrivia.timeLimit - elapsed);
    triviaTimer.textContent = `${Math.ceil(remaining)}s`;
    triviaTimerBar.style.width = `${(remaining / activeTrivia.timeLimit) * 100}%`;
    // Condition structure: when time reaches zero, the timer repetition stops.
    if (remaining <= 0) { clearInterval(triviaTimerInterval); }
  }, 100);

  triviaQuestion.textContent = data.question;
  triviaOptions.innerHTML = '';
  // Repetition structure: `.forEach` runs once for every answer option and creates one button per option.
  data.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'trivia-option';
    btn.textContent = `${opt.label.toUpperCase()}. ${opt.text}`;
    btn.dataset.label = opt.label;
    // Event handler function: this callback runs when the player clicks an answer button.
    btn.addEventListener('click', () => {
      // Condition structure: ignore clicks if the trivia question has already ended.
      if (!activeTrivia) return;
      activeTrivia.selectedLabel = opt.label;
      // Repetition structure: remove the selected style from every option before marking the new choice.
      triviaOptions.querySelectorAll('.trivia-option').forEach((option) => option.classList.remove('selected'));
      socket.emit('triviaAnswer', { questionId: activeTrivia.questionId, label: opt.label });
      btn.classList.add('selected');
    });
    triviaOptions.appendChild(btn);
  });

  triviaResult.classList.add('hidden');
  triviaOverlay.classList.remove('hidden');
  triviaTimer.textContent = `${activeTrivia.timeLimit}s`;
  triviaTimerBar.style.width = '100%';
});

socket.on('triviaResult', (data) => {
  clearInterval(triviaTimerInterval);
  clearTimeout(triviaHideTimeout);
  activeTrivia = null;
  triviaTimerBar.style.width = '0%';

  // Condition structure: choose different result text depending on whether anyone answered correctly.
  if (data.winnerId) {
    const isMe = data.winnerId === myPlayerId;
    triviaResult.textContent = isMe
      ? `Correct! You get instant speed boost.`
      : `Answer: ${data.correctLabel.toUpperCase()} — another snake got the instant speed boost.`;
  } else {
    // `else` runs when the `if (data.winnerId)` condition is false.
    triviaResult.textContent = `Answer: ${data.correctLabel.toUpperCase()} — no one got it.`;
  }
  triviaResult.classList.remove('hidden');

  const resultDelayMs = Math.max(0, Number(data.resultDisplaySeconds || data.resumeDelaySeconds || 2) * 1000);
  triviaHideTimeout = setTimeout(() => { triviaOverlay.classList.add('hidden'); }, resultDelayMs);
});

// Form event handler: this function runs when the join-room form is submitted.
joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('joinRoom', { playerName: playerNameInput.value, roomCode: roomCodeInput.value });
});
restartButton.addEventListener('click', restartGame);
overlayRestartButton.addEventListener('click', restartGame);
// Function: groups the restart steps so both restart buttons can call the same code.
function restartGame() { damagedPlayers.clear(); previousLives.clear(); socket.emit('restartGame'); }
// Keyboard event handler: this function runs every time a key is pressed.
window.addEventListener('keydown', (event) => {
  const direction = keyToDirection(event.key);
  // Condition structure: exit early if the key is not a direction or controls should be disabled.
  if (!direction || shouldIgnoreDirectionKey(event)) return;
  event.preventDefault();
  emitDirection(direction);
});
// Repetition structure: add the same touch/click control behavior to every on-screen arrow button.
mobileControlButtons.forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const direction = button.dataset.direction;
    emitDirection(direction);
  });
});
// Function: sends a direction to the server if movement controls are currently usable.
function emitDirection(direction) {
  if (!direction || !gamePanel || gamePanel.classList.contains('hidden') || !triviaOverlay.classList.contains('hidden')) return;
  socket.emit('changeDirection', direction);
}
// Function: returns true when keyboard movement should be ignored, such as while typing or answering trivia.
function shouldIgnoreDirectionKey(event) {
  const active = document.activeElement;
  const tagName = active?.tagName;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tagName) || active?.isContentEditable || !gamePanel || gamePanel.classList.contains('hidden') || !triviaOverlay.classList.contains('hidden');
}
// Function + condition structure: converts keyboard input into a game direction using an if chain.
function keyToDirection(key) { const normalized = key.toLowerCase(); if (normalized === 'arrowup' || normalized === 'w') return 'up'; if (normalized === 'arrowdown' || normalized === 's') return 'down'; if (normalized === 'arrowleft' || normalized === 'a') return 'left'; if (normalized === 'arrowright' || normalized === 'd') return 'right'; return null; }

// Function: compares current lives with previous lives so the UI can flash damaged players.
function markLifeLosses(state) {
  // Repetition structure: `for...of` loops through every player in the game state.
  for (const player of state.players) {
    const prior = previousLives.get(player.id);
    // Condition structure: only mark damage when a stored previous life count exists and the new count is lower.
    if (typeof prior === 'number' && player.lives < prior) {
      damagedPlayers.add(player.id);
      setTimeout(() => {
        damagedPlayers.delete(player.id);
        // Condition structure: only redraw if a latest game state is available.
        if (latestState) renderScoreboard(latestState);
      }, 620);
    }
    previousLives.set(player.id, player.lives);
  }
}

// Function: renders the complete game state by updating labels, overlays, scoreboard, and canvas.
function renderState(state) {
  roomLabel.textContent = state.code;
  gameMessage.textContent = formatStatusMessage(state);
  waitingScreen.classList.toggle('hidden', state.status !== 'waiting');
  gamePanel.classList.toggle('is-waiting', state.status === 'waiting');
  restartButton.classList.toggle('hidden', state.status !== 'ended');
  winnerOverlay.classList.toggle('hidden', state.status !== 'ended');
  renderCountdown(state);
  renderScoreboard(state);
  drawGame(state);
  // Condition structure: winner text is only needed after the round has ended.
  if (state.status === 'ended') {
    const isDraw = state.winner && state.winner.name === 'Draw';
    const isMe = state.winner && state.winner.id === myPlayerId;
    winnerTitle.textContent = isDraw ? 'It’s a draw' : `${state.winner?.name || 'Player'} wins`;
    const scoreLine = state.players.map((p) => `${p.name}: ${p.score} snacks, ${p.lives} lives`).join(' • ');
    winnerText.textContent = isDraw ? `Equal damage. ${scoreLine}` : (isMe ? `You won the clash! ${scoreLine}` : `Round lost — try a cleaner route. ${scoreLine}`);
  }
}

// Function: turns server state into a player-readable status message.
function formatStatusMessage(state) {
  // Condition structure: this if/else-if style chain selects the correct message for each game status.
  if (state.status === 'waiting') return `Waiting for at least ${state.minPlayers || 2} snakes in room ${state.code}…`;
  if (state.status === 'countdown') return state.countdown?.message || 'Get ready…';
  if (state.status === 'playing') {
    // Nested conditions: when playing, inspect the server message for special wording.
    if (/snakes are in/i.test(state.message || '')) return state.message;
    if (/lost a life/i.test(state.message || '')) return state.message.replace(/lost a life/g, 'lost a heart');
    if (/Game restarted/i.test(state.message || '')) return 'New round. Fresh tails.';
    return state.message || 'Battle in progress — eat snacks and protect your hearts.';
  }
  if (state.status === 'ended') return state.message || 'Game over.';
  return state.message || '';
}

// Function: shows or hides the countdown overlay.
function renderCountdown(state) {
  const active = state.status === 'countdown' && state.countdown;
  countdownOverlay.classList.toggle('hidden', !active);
  // Condition structure: if there is no active countdown, stop here.
  if (!active) return;

  countdownNumber.textContent = state.countdown.value;
  countdownText.textContent = state.countdown.phase === 'respawn'
    ? 'Respawning after the crash'
    : 'Match starts soon';
}

// Function: rebuilds the scoreboard cards from the current players array.
function renderScoreboard(state) {
  scoreboard.innerHTML = '';
  // Repetition structure: create one scoreboard card for each player.
  for (const player of state.players) {
    const card = document.createElement('article');
    card.className = `player-card${player.id === myPlayerId ? ' you' : ''}${damagedPlayers.has(player.id) ? ' damaged' : ''}`;
    card.style.setProperty('--player-color', player.color);
    const badge = player.id === myPlayerId ? 'You' : `P${player.slot + 1}`;
    card.innerHTML = `<div class="player-name"><span class="color-dot" style="background:${player.color}; color:${player.color}"></span><span>${escapeHtml(player.name)}</span><span class="badge">${badge}</span>${player.speedBoost && player.speedBoost.expiresAt > Date.now() ? '<span class="speed-badge">⚡ Speed boost active</span>' : ''}</div><div class="stats"><span class="stat">Score: ${player.score}</span><span class="stat hearts">Hearts: ${'❤'.repeat(Math.max(0, player.lives))}${player.lives <= 0 ? '0' : ''}</span><span class="stat">Length: ${player.snake.length}</span></div>`;
    scoreboard.appendChild(card);
  }
}

// Function: draws one full frame of the game board on the canvas.
function drawGame(state) {
  const gridW = state.grid.width;
  const gridH = state.grid.height;
  const cell = Math.floor(Math.min(canvas.width / gridW, canvas.height / gridH));
  const offsetX = Math.floor((canvas.width - gridW * cell) / 2);
  const offsetY = Math.floor((canvas.height - gridH * cell) / 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fbf6ea';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawBoardFrame(gridW, gridH, cell, offsetX, offsetY);
  drawGrid(gridW, gridH, cell, offsetX, offsetY);
  // Condition structures: draw optional objects only when the server says they exist.
  if (state.food) drawFood(state.food, cell, offsetX, offsetY);
  if (state.powerup) drawPowerup(state.powerup, cell, offsetX, offsetY);
  // Repetition structure: draw every player's snake.
  for (const player of state.players) drawSnake(player, cell, offsetX, offsetY);
}

// Function: draws the rounded board background/frame behind the grid.
function drawBoardFrame(gridW, gridH, cell, offsetX, offsetY) {
  ctx.fillStyle = '#fffdf7';
  roundRect(offsetX - 6, offsetY - 6, gridW * cell + 12, gridH * cell + 12, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28, 28, 28, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Function: draws the grid lines.
function drawGrid(gridW, gridH, cell, offsetX, offsetY) {
  ctx.strokeStyle = 'rgba(28, 28, 28, 0.08)';
  ctx.lineWidth = 1;
  // Repetition structure: this `for` loop draws every vertical grid line.
  for (let x = 0; x <= gridW; x += 1) { ctx.beginPath(); ctx.moveTo(offsetX + x * cell, offsetY); ctx.lineTo(offsetX + x * cell, offsetY + gridH * cell); ctx.stroke(); }
  // Repetition structure: this `for` loop draws every horizontal grid line.
  for (let y = 0; y <= gridH; y += 1) { ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y * cell); ctx.lineTo(offsetX + gridW * cell, offsetY + y * cell); ctx.stroke(); }
}

// Function: draws the orange food/snack item at its grid position.
function drawFood(food, cell, offsetX, offsetY) {
  const cx = offsetX + food.x * cell + cell / 2;
  const cy = offsetY + food.y * cell + cell / 2;
  const pulse = 0.72 + 0.18 * Math.sin(Date.now() / 140);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 122, 26, 0.35)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ff7a1a';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(6, cell * 0.32 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff2c6';
  ctx.beginPath();
  ctx.arc(cx - cell * 0.08, cy - cell * 0.08, Math.max(2, cell * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2f7d32';
  ctx.lineWidth = Math.max(2, cell * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx + cell * 0.08, cy - cell * 0.26);
  ctx.quadraticCurveTo(cx + cell * 0.22, cy - cell * 0.42, cx + cell * 0.38, cy - cell * 0.34);
  ctx.stroke();
  ctx.restore();
}

// Function: draws a star-like powerup at its grid position.
function drawPowerup(powerup, cell, offsetX, offsetY) {
  const cx = offsetX + powerup.x * cell + cell / 2;
  const cy = offsetY + powerup.y * cell + cell / 2;
  const radius = Math.max(7, cell * 0.34);
  ctx.save();
  ctx.shadowColor = 'rgba(250, 204, 21, 0.7)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  // Repetition structure: loop 10 times to create alternating outer/inner points of the star shape.
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    // Condition structure: the first point starts the shape; later points draw lines from the previous point.
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#7c2d12';
  ctx.font = `${Math.max(12, cell * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(powerup.type === 'speed' ? '⚡' : '★', cx, cy + 1);
  ctx.restore();
}

// Function: draws one player's snake, including boost glow and head details.
function drawSnake(player, cell, offsetX, offsetY) {
  const boosted = player.speedBoost && player.speedBoost.expiresAt > Date.now();
  // Condition structure: only draw the glow when the player's speed boost is active.
  if (boosted) {
    // Draw glow behind snake
    ctx.save();
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 18;
    // Repetition structure: `.forEach` draws the glow for every snake segment.
    player.snake.forEach((segment) => {
      const px = offsetX + segment.x * cell + 2;
      const py = offsetY + segment.y * cell + 2;
      const size = cell - 4;
      ctx.fillStyle = player.color + '55';
      ctx.fillRect(px, py, size, size);
    });
    ctx.restore();
  }
  // Repetition structure: `.forEach` draws every segment of the snake body.
  player.snake.forEach((segment, index) => {
    const alpha = index === 0 ? 1 : Math.max(0.34, 0.92 - index * 0.035);
    ctx.globalAlpha = alpha;
    drawRoundedCell(segment.x, segment.y, cell, offsetX, offsetY, player.color, index === 0 ? 9 : 7);
    // Condition structure: only the first segment is the head, so only it gets a face badge.
    if (index === 0) drawHeadBadge(segment, player, cell, offsetX, offsetY);
  });
  ctx.globalAlpha = 1;
}

// Function: draws eyes and a different mouth shape for each player slot.
function drawHeadBadge(segment, player, cell, offsetX, offsetY) {
  const cx = offsetX + segment.x * cell + cell / 2;
  const cy = offsetY + segment.y * cell + cell / 2;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(cx - cell * 0.13, cy - cell * 0.09, Math.max(2, cell * 0.055), 0, Math.PI * 2);
  ctx.arc(cx + cell * 0.13, cy - cell * 0.09, Math.max(2, cell * 0.055), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = Math.max(2, cell * 0.08);
  ctx.beginPath();
  // Condition structure: this if / else-if / else chain chooses a mouth shape based on the player's slot.
  if (player.slot === 0) {
    ctx.arc(cx, cy + cell * 0.16, cell * 0.16, 0.16 * Math.PI, 0.84 * Math.PI);
  } else if (player.slot === 1) {
    ctx.moveTo(cx - cell * 0.17, cy + cell * 0.18);
    ctx.lineTo(cx, cy + cell * 0.30);
    ctx.lineTo(cx + cell * 0.17, cy + cell * 0.18);
  } else if (player.slot === 2) {
    ctx.moveTo(cx - cell * 0.20, cy + cell * 0.20);
    ctx.lineTo(cx + cell * 0.20, cy + cell * 0.20);
  } else {
    ctx.rect(cx - cell * 0.14, cy + cell * 0.12, cell * 0.28, cell * 0.16);
  }
  ctx.stroke();
  ctx.restore();
}

// Function: draws one rounded square cell for a snake segment.
function drawRoundedCell(x, y, cell, offsetX, offsetY, color, radius) {
  const gap = 2;
  const px = offsetX + x * cell + gap;
  const py = offsetY + y * cell + gap;
  const size = cell - gap * 2;
  ctx.fillStyle = color;
  roundRect(px, py, size, size, radius);
  ctx.fill();
}
// Function: creates a rounded rectangle path on the canvas; callers fill or stroke it afterward.
function roundRect(x, y, width, height, radius) { const r = Math.min(radius, width / 2, height / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath(); }
// Function: escapes user/player text before inserting it into HTML to prevent markup injection.
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
// Function + animation repetition: requestAnimationFrame repeatedly calls `animationLoop` for smooth drawing.
function animationLoop() { if (latestState) drawGame(latestState); requestAnimationFrame(animationLoop); }

// Function call: starts the repeating animation loop.
animationLoop();
