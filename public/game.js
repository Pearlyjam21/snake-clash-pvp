const socket = io();
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
const ctx = canvas.getContext('2d');
let myPlayerId = null;
let latestState = null;
let previousLives = new Map();
const damagedPlayers = new Set();

socket.on('connect', () => { connectionStatus.textContent = 'Connected'; connectionStatus.classList.add('online'); });
socket.on('disconnect', () => { connectionStatus.textContent = 'Disconnected'; connectionStatus.classList.remove('online'); });
socket.on('joined', ({ playerId, roomCode }) => { myPlayerId = playerId; roomLabel.textContent = roomCode; joinPanel.classList.add('hidden'); gamePanel.classList.remove('hidden'); joinError.textContent = ''; });
socket.on('joinError', (message) => { joinError.textContent = message; });
socket.on('gameState', (state) => {
  markLifeLosses(state);
  latestState = state;
  renderState(state);
});

let activeTrivia = null;
let triviaTimerInterval = null;
let triviaHideTimeout = null;

socket.on('triviaQuestion', (data) => {
  clearInterval(triviaTimerInterval);
  clearTimeout(triviaHideTimeout);
  activeTrivia = {
    questionId: data.questionId,
    timeLimit: data.timeLimit,
    _startMs: Date.now(),
    selectedLabel: null
  };
  triviaTimerInterval = setInterval(() => {
    if (!activeTrivia) { clearInterval(triviaTimerInterval); return; }
    const elapsed = (Date.now() - activeTrivia._startMs) / 1000;
    const remaining = Math.max(0, activeTrivia.timeLimit - elapsed);
    triviaTimer.textContent = `${Math.ceil(remaining)}s`;
    triviaTimerBar.style.width = `${(remaining / activeTrivia.timeLimit) * 100}%`;
    if (remaining <= 0) { clearInterval(triviaTimerInterval); }
  }, 100);

  triviaQuestion.textContent = data.question;
  triviaOptions.innerHTML = '';
  data.options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'trivia-option';
    btn.textContent = `${opt.label.toUpperCase()}. ${opt.text}`;
    btn.dataset.label = opt.label;
    btn.addEventListener('click', () => {
      if (!activeTrivia) return;
      activeTrivia.selectedLabel = opt.label;
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

  if (data.winnerId) {
    const isMe = data.winnerId === myPlayerId;
    triviaResult.textContent = isMe
      ? `Correct! You get instant speed boost.`
      : `Answer: ${data.correctLabel.toUpperCase()} — another snake got the instant speed boost.`;
  } else {
    triviaResult.textContent = `Answer: ${data.correctLabel.toUpperCase()} — no one got it.`;
  }
  triviaResult.classList.remove('hidden');

  const resultDelayMs = Math.max(0, Number(data.resultDisplaySeconds || data.resumeDelaySeconds || 2) * 1000);
  triviaHideTimeout = setTimeout(() => { triviaOverlay.classList.add('hidden'); }, resultDelayMs);
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('joinRoom', { playerName: playerNameInput.value, roomCode: roomCodeInput.value });
});
restartButton.addEventListener('click', restartGame);
overlayRestartButton.addEventListener('click', restartGame);
function restartGame() { damagedPlayers.clear(); previousLives.clear(); socket.emit('restartGame'); }
window.addEventListener('keydown', (event) => {
  const direction = keyToDirection(event.key);
  if (!direction || shouldIgnoreDirectionKey(event)) return;
  event.preventDefault();
  socket.emit('changeDirection', direction);
});
function shouldIgnoreDirectionKey(event) {
  const active = document.activeElement;
  const tagName = active?.tagName;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tagName) || active?.isContentEditable || !gamePanel || gamePanel.classList.contains('hidden') || !triviaOverlay.classList.contains('hidden');
}
function keyToDirection(key) { const normalized = key.toLowerCase(); if (normalized === 'arrowup' || normalized === 'w') return 'up'; if (normalized === 'arrowdown' || normalized === 's') return 'down'; if (normalized === 'arrowleft' || normalized === 'a') return 'left'; if (normalized === 'arrowright' || normalized === 'd') return 'right'; return null; }

function markLifeLosses(state) {
  for (const player of state.players) {
    const prior = previousLives.get(player.id);
    if (typeof prior === 'number' && player.lives < prior) {
      damagedPlayers.add(player.id);
      setTimeout(() => {
        damagedPlayers.delete(player.id);
        if (latestState) renderScoreboard(latestState);
      }, 620);
    }
    previousLives.set(player.id, player.lives);
  }
}

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
  if (state.status === 'ended') {
    const isDraw = state.winner && state.winner.name === 'Draw';
    const isMe = state.winner && state.winner.id === myPlayerId;
    winnerTitle.textContent = isDraw ? 'It’s a draw' : `${state.winner?.name || 'Player'} wins`;
    const scoreLine = state.players.map((p) => `${p.name}: ${p.score} snacks, ${p.lives} lives`).join(' • ');
    winnerText.textContent = isDraw ? `Equal damage. ${scoreLine}` : (isMe ? `You won the clash! ${scoreLine}` : `Round lost — try a cleaner route. ${scoreLine}`);
  }
}

function formatStatusMessage(state) {
  if (state.status === 'waiting') return `Waiting for at least ${state.minPlayers || 2} snakes in room ${state.code}…`;
  if (state.status === 'countdown') return state.countdown?.message || 'Get ready…';
  if (state.status === 'playing') {
    if (/snakes are in/i.test(state.message || '')) return state.message;
    if (/lost a life/i.test(state.message || '')) return state.message.replace(/lost a life/g, 'lost a heart');
    if (/Game restarted/i.test(state.message || '')) return 'New round. Fresh tails.';
    return state.message || 'Battle in progress — eat snacks and protect your hearts.';
  }
  if (state.status === 'ended') return state.message || 'Game over.';
  return state.message || '';
}

function renderCountdown(state) {
  const active = state.status === 'countdown' && state.countdown;
  countdownOverlay.classList.toggle('hidden', !active);
  if (!active) return;

  countdownNumber.textContent = state.countdown.value;
  countdownText.textContent = state.countdown.phase === 'respawn'
    ? 'Respawning after the crash'
    : 'Match starts soon';
}

function renderScoreboard(state) {
  scoreboard.innerHTML = '';
  for (const player of state.players) {
    const card = document.createElement('article');
    card.className = `player-card${player.id === myPlayerId ? ' you' : ''}${damagedPlayers.has(player.id) ? ' damaged' : ''}`;
    card.style.setProperty('--player-color', player.color);
    const badge = player.id === myPlayerId ? 'You' : `P${player.slot + 1}`;
    card.innerHTML = `<div class="player-name"><span class="color-dot" style="background:${player.color}; color:${player.color}"></span><span>${escapeHtml(player.name)}</span><span class="badge">${badge}</span>${player.speedBoost && player.speedBoost.expiresAt > Date.now() ? '<span class="speed-badge">⚡ Speed boost active</span>' : ''}</div><div class="stats"><span class="stat">Score: ${player.score}</span><span class="stat hearts">Hearts: ${'❤'.repeat(Math.max(0, player.lives))}${player.lives <= 0 ? '0' : ''}</span><span class="stat">Length: ${player.snake.length}</span></div>`;
    scoreboard.appendChild(card);
  }
}

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
  if (state.food) drawFood(state.food, cell, offsetX, offsetY);
  if (state.powerup) drawPowerup(state.powerup, cell, offsetX, offsetY);
  for (const player of state.players) drawSnake(player, cell, offsetX, offsetY);
}

function drawBoardFrame(gridW, gridH, cell, offsetX, offsetY) {
  ctx.fillStyle = '#fffdf7';
  roundRect(offsetX - 6, offsetY - 6, gridW * cell + 12, gridH * cell + 12, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28, 28, 28, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawGrid(gridW, gridH, cell, offsetX, offsetY) {
  ctx.strokeStyle = 'rgba(28, 28, 28, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= gridW; x += 1) { ctx.beginPath(); ctx.moveTo(offsetX + x * cell, offsetY); ctx.lineTo(offsetX + x * cell, offsetY + gridH * cell); ctx.stroke(); }
  for (let y = 0; y <= gridH; y += 1) { ctx.beginPath(); ctx.moveTo(offsetX, offsetY + y * cell); ctx.lineTo(offsetX + gridW * cell, offsetY + y * cell); ctx.stroke(); }
}

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

function drawPowerup(powerup, cell, offsetX, offsetY) {
  const cx = offsetX + powerup.x * cell + cell / 2;
  const cy = offsetY + powerup.y * cell + cell / 2;
  const radius = Math.max(7, cell * 0.34);
  ctx.save();
  ctx.shadowColor = 'rgba(250, 204, 21, 0.7)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
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

function drawSnake(player, cell, offsetX, offsetY) {
  const boosted = player.speedBoost && player.speedBoost.expiresAt > Date.now();
  if (boosted) {
    // Draw glow behind snake
    ctx.save();
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 18;
    player.snake.forEach((segment) => {
      const px = offsetX + segment.x * cell + 2;
      const py = offsetY + segment.y * cell + 2;
      const size = cell - 4;
      ctx.fillStyle = player.color + '55';
      ctx.fillRect(px, py, size, size);
    });
    ctx.restore();
  }
  player.snake.forEach((segment, index) => {
    const alpha = index === 0 ? 1 : Math.max(0.34, 0.92 - index * 0.035);
    ctx.globalAlpha = alpha;
    drawRoundedCell(segment.x, segment.y, cell, offsetX, offsetY, player.color, index === 0 ? 9 : 7);
    if (index === 0) drawHeadBadge(segment, player, cell, offsetX, offsetY);
  });
  ctx.globalAlpha = 1;
}

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

function drawRoundedCell(x, y, cell, offsetX, offsetY, color, radius) {
  const gap = 2;
  const px = offsetX + x * cell + gap;
  const py = offsetY + y * cell + gap;
  const size = cell - gap * 2;
  ctx.fillStyle = color;
  roundRect(px, py, size, size, radius);
  ctx.fill();
}
function roundRect(x, y, width, height, radius) { const r = Math.min(radius, width / 2, height / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath(); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function animationLoop() { if (latestState) drawGame(latestState); requestAnimationFrame(animationLoop); }
animationLoop();
