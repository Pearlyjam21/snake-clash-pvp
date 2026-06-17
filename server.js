const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GRID_WIDTH = 32;
const GRID_HEIGHT = 22;
const START_LIVES = 3;
const START_LENGTH = 4;
const TICK_MS = 120;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const COUNTDOWN_SECONDS = 3;
const TRIVIA_TIME_SECONDS = 10;
const FOODS_PER_POWERUP = 1;

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const SLOT_CONFIG = [
  { slot: 0, color: '#4ade80', startDir: 'right', start: { x: 7, y: Math.floor(GRID_HEIGHT / 2) } },
  { slot: 1, color: '#60a5fa', startDir: 'left', start: { x: GRID_WIDTH - 8, y: Math.floor(GRID_HEIGHT / 2) } },
  { slot: 2, color: '#c084fc', startDir: 'down', start: { x: Math.floor(GRID_WIDTH / 2), y: 5 } },
  { slot: 3, color: '#facc15', startDir: 'up', start: { x: Math.floor(GRID_WIDTH / 2), y: GRID_HEIGHT - 6 } }
];

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ playerName, roomCode } = {}) => {
    const name = sanitizeName(playerName);
    const code = sanitizeRoom(roomCode);

    if (!name || !code) {
      socket.emit('joinError', 'Enter a player name and room code.');
      return;
    }

    let room = rooms.get(code);
    if (!room) {
      room = createRoom(code);
      rooms.set(code, room);
    }

    if (room.status === 'playing') {
      socket.emit('joinError', `Room ${code} already started. Join the next round.`);
      return;
    }

    if (room.players.length >= MAX_PLAYERS && !room.players.some((p) => p.id === socket.id)) {
      socket.emit('joinError', `Room ${code} is full.`);
      return;
    }

    if (room.players.some((p) => p.id === socket.id)) {
      socket.emit('joinError', 'You already joined this room.');
      return;
    }

    const slot = nextOpenSlot(room);
    if (slot === -1) {
      socket.emit('joinError', `Room ${code} has no open slot.`);
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;

    const config = SLOT_CONFIG[slot];
    const player = {
      id: socket.id,
      name,
      slot,
      color: config.color,
      score: 0,
      lives: START_LIVES,
      direction: config.startDir,
      nextDirection: config.startDir,
      snake: createStartingSnake(slot),
      connected: true
    };

    room.players.push(player);
    socket.emit('joined', { playerId: socket.id, roomCode: code, slot });

    if (room.players.length >= MIN_PLAYERS && room.status === 'waiting') {
      resetRoomForMatch(room);
      startCountdown(room, 'start', 'Match starts in', () => {
        room.status = 'playing';
        emitSystem(room, `${room.players.length} snakes are in. Go!`);
        startLoop(room);
      });
    } else if (room.status === 'countdown') {
      room.food = randomFood(room);
      emitSystem(room, `${room.players.length} snakes joined. Match starts soon.`);
    } else {
      room.status = 'waiting';
      emitSystem(room, `Waiting for at least ${MIN_PLAYERS} snakes in room ${code}.`);
      broadcast(room);
    }
  });

  socket.on('changeDirection', (direction) => {
    const player = getSocketPlayer(socket);
    if (!player || !DIRECTIONS[direction]) return;
    if (isOpposite(player.direction, direction)) return;
    player.nextDirection = direction;
  });

  socket.on('triviaAnswer', ({ questionId, label } = {}) => {
    const room = getSocketRoom(socket);
    if (!room || room.status !== 'playing') return;
    if (!room.trivia || room.trivia.questionId !== questionId) return;
    handleTriviaAnswer(room, socket.id, label);
  });

  socket.on('restartGame', () => {
    const room = getSocketRoom(socket);
    if (!room || room.players.length < MIN_PLAYERS) return;
    resetRoomForMatch(room);
    startCountdown(room, 'start', 'Restart starts in', () => {
      room.status = 'playing';
      emitSystem(room, 'New round. Fresh tails.');
      startLoop(room);
    });
  });

  socket.on('disconnect', () => {
    const room = getSocketRoom(socket);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    socket.leave(room.code);

    if (room.players.length === 0) {
      stopLoop(room);
      stopCountdown(room);
      rooms.delete(room.code);
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      stopLoop(room);
      stopCountdown(room);
      room.status = 'waiting';
      room.winner = null;
      room.countdown = null;
      room.food = null;
      room.foodsEaten = 0;
      room.powerup = null;
      clearTrivia(room);
      for (const player of room.players) {
        resetPlayerForWaiting(player);
      }
      emitSystem(room, `Waiting for at least ${MIN_PLAYERS} snakes in room ${room.code}.`);
      broadcast(room);
      return;
    }

    if (room.status === 'countdown') {
      room.food = randomFood(room);
      emitSystem(room, `${room.players.length} snakes remain. Match starts soon.`);
      return;
    }

    if (room.status === 'playing') {
      room.food = randomFood(room);
      emitSystem(room, 'A snake left the room. Battle continues.');
      return;
    }

    broadcast(room);
  });
});

function createRoom(code) {
  return {
    code,
    players: [],
    food: null,
    status: 'waiting',
    winner: null,
    message: '',
    interval: null,
    countdownTimer: null,
    countdown: null,
    tick: 0,
    foodsEaten: 0,
    powerup: null,
    trivia: null
  };
}

function sanitizeName(value) {
  return String(value || '').trim().slice(0, 20);
}

function sanitizeRoom(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
}

function nextOpenSlot(room) {
  for (const config of SLOT_CONFIG) {
    if (!room.players.some((p) => p.slot === config.slot)) return config.slot;
  }
  return -1;
}

function resetRoomForMatch(room) {
  stopLoop(room);
  stopCountdown(room);
  clearTrivia(room);
  room.tick = 0;
  room.winner = null;
  room.message = '';
  room.countdown = null;
  room.powerup = null;
  // Keep foodsEaten — let it accumulate across rounds so trivia can still trigger
  for (const player of room.players) {
    resetPlayerForWaiting(player);
  }
  room.food = randomFood(room);
  broadcast(room);
}

function resetPlayerForWaiting(player) {
  const config = SLOT_CONFIG[player.slot];
  player.score = 0;
  player.lives = START_LIVES;
  player.direction = config.startDir;
  player.nextDirection = config.startDir;
  player.snake = createStartingSnake(player.slot);
}

function createStartingSnake(slot) {
  const config = SLOT_CONFIG[slot];
  const snake = [];
  const dir = DIRECTIONS[config.startDir];
  for (let i = 0; i < START_LENGTH; i += 1) {
    snake.push({ x: config.start.x - dir.x * i, y: config.start.y - dir.y * i });
  }
  return snake;
}

function startLoop(room) {
  stopLoop(room);
  room.interval = setInterval(() => tickRoom(room), TICK_MS);
}

function stopLoop(room) {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function startCountdown(room, phase, messagePrefix, onComplete) {
  stopLoop(room);
  stopCountdown(room);
  room.status = 'countdown';
  room.countdown = {
    phase,
    value: COUNTDOWN_SECONDS,
    message: `${messagePrefix} ${COUNTDOWN_SECONDS}`
  };
  broadcast(room);

  room.countdownTimer = setInterval(() => {
    if (room.players.length < MIN_PLAYERS) {
      stopCountdown(room);
      return;
    }

    const nextValue = room.countdown.value - 1;
    if (nextValue <= 0) {
      stopCountdown(room);
      room.countdown = null;
      onComplete();
      return;
    }

    room.countdown.value = nextValue;
    room.countdown.message = `${messagePrefix} ${nextValue}`;
    broadcast(room);
  }, 1000);
}

function stopCountdown(room) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
}

function tickRoom(room) {
  const activePlayers = room.players.filter((player) => player.lives > 0);
  if (room.status !== 'playing' || activePlayers.length < MIN_PLAYERS) return;
  room.tick += 1;

  // Update direction for all players
  for (const player of activePlayers) {
    if (!isOpposite(player.direction, player.nextDirection)) player.direction = player.nextDirection;
  }

  // Grace period after respawn — only move, no collision checks
  // graceTicks are NOT decremented during the countdown (room.status !== 'playing')
  // so value must be set high enough to cover countdown + post-countdown spread
  if (room.graceTicks && room.graceTicks > 0 && room.status === 'playing') {
    room.graceTicks -= 1;
    for (const player of activePlayers) {
      const vector = DIRECTIONS[player.direction];
      const head = player.snake[0];
      const nextHead = { x: head.x + vector.x, y: head.y + vector.y };
      if (!isOutside(nextHead)) {
        if (sameCell(nextHead, room.food)) {
          player.score += 1;
          room.foodsEaten += 1;
          room.food = randomFood(room);
        }
        player.snake.unshift(nextHead);
        player.snake.pop();
      }
    }
    // Ensure food is always reachable — spawn adjacent to a random active head
    if (!room.food || containsCell(allSnakeCells(activePlayers), room.food)) {
      const randomPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
      if (randomPlayer) {
        const head = randomPlayer.snake[0];
        const dirs = ['up', 'down', 'left', 'right'];
        for (const dir of dirs) {
          const d = DIRECTIONS[dir];
          const candidate = { x: head.x + d.x, y: head.y + d.y };
          if (!isOutside(candidate) && !containsCell(allSnakeCells(activePlayers), candidate)) {
            room.food = candidate;
            break;
          }
        }
        if (!room.food) room.food = randomFood(room);
      }
    }
    room.message = '';
    if (triggerTriviaIfReady(room)) return;
    broadcast(room);
    return;
  }

  // Normal tick — build plans and check collisions
  const plans = new Map(activePlayers.map((player) => {
    const vector = DIRECTIONS[player.direction];
    const head = player.snake[0];
    const nextHead = { x: head.x + vector.x, y: head.y + vector.y };
    const secondHead = { x: nextHead.x + vector.x, y: nextHead.y + vector.y };
    const boosted = !!(player.speedBoost && player.speedBoost.expiresAt > Date.now());
    const eats = sameCell(nextHead, room.food);
    const secondEats = boosted && sameCell(secondHead, room.food);
    return [player.id, { player, nextHead, secondHead, boosted, eats, secondEats, losesLife: false, reasons: [] }];
  }));

  resolveHeadCollisions(activePlayers, plans, room.food);

  for (const player of activePlayers) {
    const plan = plans.get(player.id);
    if (plan.losesLife) continue;
    if (isOutside(plan.nextHead)) { plan.losesLife = true; plan.reasons.push('wall'); continue; }
    if (plan.boosted && isOutside(plan.secondHead)) { plan.losesLife = true; plan.reasons.push('wall'); continue; }
    const ownBody = bodyForCollision(player, plan.eats);
    if (containsCell(ownBody, plan.nextHead)) { plan.losesLife = true; plan.reasons.push('own body'); continue; }
    if (plan.boosted && containsCell(ownBody, plan.secondHead)) { plan.losesLife = true; plan.reasons.push('own body'); continue; }
    for (const enemy of activePlayers) {
      if (enemy.id === player.id) continue;
      const enemyPlan = plans.get(enemy.id);
      const enemyBody = bodyForCollision(enemy, enemyPlan.eats);
      if (containsCell(enemyBody, plan.nextHead)) { plan.losesLife = true; plan.reasons.push('enemy body'); break; }
      if (plan.boosted && containsCell(enemyBody, plan.secondHead)) { plan.losesLife = true; plan.reasons.push('enemy body'); break; }
    }
  }

  const losers = [...plans.values()].filter((plan) => plan.losesLife).map((plan) => plan.player);

  if (losers.length > 0) {
    for (const loser of losers) { loser.lives -= 1; if (loser.lives <= 0) loser.snake = []; }
  }

  for (const plan of plans.values()) {
    if (plan.losesLife || plan.player.lives <= 0) continue;
    plan.player.snake.unshift(plan.nextHead);
    if (plan.eats) { plan.player.score += 1; room.foodsEaten += 1; } else { plan.player.snake.pop(); }
    if (plan.boosted && plan.player.lives > 0) {
      plan.player.snake.unshift(plan.secondHead);
      if (plan.secondEats) { plan.player.score += 1; room.foodsEaten += 1; } else { plan.player.snake.pop(); }
    }
  }

  if ([...plans.values()].some((plan) => (plan.eats || plan.secondEats) && !plan.losesLife)) {
    if (!room.powerup) room.food = randomFood(room);
  }

  // Check powerup collection
  if (room.powerup) {
    for (const player of room.players.filter((p) => p.lives > 0)) {
      const plan = plans.get(player.id);
      if (plan.losesLife) continue;
      if (sameCell(plan.nextHead, room.powerup) || (plan.boosted && sameCell(plan.secondHead, room.powerup))) {
        io.to(room.code).emit('powerupCollected', { playerId: player.id, powerupType: room.powerup.type, x: room.powerup.x, y: room.powerup.y });
        player.speedBoost = { expiresAt: Date.now() + 15000 };
        room.powerup = null;
        break;
      }
    }
  }

  // Check if trivia should trigger
  if (triggerTriviaIfReady(room)) return;

  const alive = room.players.filter((p) => p.lives > 0);
  if (alive.length <= 1) {
    room.status = 'ended';
    stopLoop(room);
    room.winner = alive.length === 1 ? { id: alive[0].id, name: alive[0].name } : { id: null, name: 'Draw' };
    room.message = room.winner.name === 'Draw' ? 'All snakes fell. Draw.' : `${room.winner.name} wins.`;
    if (alive.length >= MIN_PLAYERS && triggerTriviaIfReady(room)) return;
    broadcast(room);
    return;
  }

  if (losers.length > 0) {
    const respawning = losers.filter((player) => player.lives > 0);
    const eliminated = losers.filter((player) => player.lives <= 0);
    const occupied = allSnakeCells(room.players.filter((p) => !respawning.includes(p) && p.lives > 0));
    for (const loser of respawning) respawnPlayer(loser, occupied);
    const lossMessage = respawning.map((p) => `${p.name} lost a life`);
    const eliminationMessage = eliminated.map((p) => `${p.name} is out`);
    room.message = [...lossMessage, ...eliminationMessage].join(' and ') + '.';
    if (respawning.length > 0) {
      room.graceTicks = 30; // must survive the 3-second countdown (25 ticks at 120ms)
      startCountdown(room, 'respawn', 'Respawn in', () => {
        room.status = 'playing';
        room.message = 'Back on the board.';
        startLoop(room);
        broadcast(room);
      });
      return;
    }
  }

  room.message = losers.length > 0 ? room.message : '';
  broadcast(room);
}

function resolveHeadCollisions(players, plans, food) {
  const targetGroups = new Map();
  for (const player of players) {
    const plan = plans.get(player.id);
    const cells = [plan.nextHead];
    if (plan.boosted) cells.push(plan.secondHead);
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      if (!targetGroups.has(key)) targetGroups.set(key, []);
      targetGroups.get(key).push({ player, cell });
    }
  }

  for (const group of targetGroups.values()) {
    if (group.length > 1) {
      // Among players in this cell, mark the shortest snake as loser
      const shortestLen = Math.min(...group.map((g) => g.player.snake.length));
      const losers = group.filter((g) => g.player.snake.length === shortestLen).map((g) => g.player);
      const reason = losers.length === 1 ? 'head collision: shorter snake' : 'head collision: equal length';
      for (const loser of losers) {
        const plan = plans.get(loser.id);
        plan.losesLife = true;
        plan.reasons.push(reason);
      }
    }
  }

  // Check swapped heads (A's next head = B's current head AND B's next head = A's current head)
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const planA = plans.get(a.id);
      const planB = plans.get(b.id);
      const swappedHeads = sameCell(planA.nextHead, b.snake[0]) && sameCell(planB.nextHead, a.snake[0]);
      if (swappedHeads) {
        markShortestHeadCollisionLosers([a, b], plans, 'head collision: swapped heads');
      }
    }
  }
}

function markShortestHeadCollisionLosers(players, plans, reason) {
  const shortestLength = Math.min(...players.map((player) => player.snake.length));
  const shortest = players.filter((player) => player.snake.length === shortestLength);
  const losers = shortest.length === 1 ? shortest : players;
  for (const loser of losers) {
    const plan = plans.get(loser.id);
    plan.losesLife = true;
    plan.reasons.push(shortest.length === 1 ? `${reason}: shorter snake` : `${reason}: equal length`);
  }
}

function bodyForCollision(player, willEat) {
  return willEat ? player.snake : player.snake.slice(0, -1);
}

function respawnPlayer(player, occupied) {
  const config = SLOT_CONFIG[player.slot];
  player.direction = config.startDir;
  player.nextDirection = config.startDir;
  player.snake = findRespawnSnake(player.slot, occupied);
  occupied.push(...player.snake);
}

function findRespawnSnake(slot, occupied) {
  const config = SLOT_CONFIG[slot];
  const dir = DIRECTIONS[config.startDir];
  const candidateYs = [config.start.y, 5, GRID_HEIGHT - 6, 9, GRID_HEIGHT - 10].filter((y) => y > 1 && y < GRID_HEIGHT - 1);
  for (const y of candidateYs) {
    const candidate = [];
    for (let i = 0; i < START_LENGTH; i += 1) {
      candidate.push({ x: config.start.x - dir.x * i, y });
    }
    if (!candidate.some((cell) => containsCell(occupied, cell))) return candidate;
  }
  return createStartingSnake(slot);
}

function randomFood(room) {
  // Bias toward rows near active snakes so food is reachable
  const activeYs = room.players
    .filter((p) => p.lives > 0 && p.snake.length > 0)
    .flatMap((p) => p.snake.map((s) => s.y));
  const biasedY = activeYs.length > 0
    ? activeYs[Math.floor(Math.random() * activeYs.length)]
    : Math.floor(GRID_HEIGHT / 2);

  const occupied = allSnakeCells(room.players);
  const free = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const cell = { x, y };
      if (!containsCell(occupied, cell)) {
        const dist = Math.abs(y - biasedY);
        for (let i = 0; i < (GRID_HEIGHT - dist); i += 1) free.push(cell);
      }
    }
  }
  if (free.length === 0) return { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };
  return free[Math.floor(Math.random() * free.length)];
}

function allSnakeCells(players) {
  return players.flatMap((player) => player.snake.map((cell) => ({ ...cell })));
}

function containsCell(cells, target) {
  return cells.some((cell) => sameCell(cell, target));
}

function sameCell(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function isOutside(cell) {
  return cell.x < 0 || cell.x >= GRID_WIDTH || cell.y < 0 || cell.y >= GRID_HEIGHT;
}

function isOpposite(current, next) {
  return (current === 'up' && next === 'down') ||
    (current === 'down' && next === 'up') ||
    (current === 'left' && next === 'right') ||
    (current === 'right' && next === 'left');
}

function getSocketRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

function getSocketPlayer(socket) {
  const room = getSocketRoom(socket);
  return room ? room.players.find((p) => p.id === socket.id) : null;
}

function emitSystem(room, message) {
  room.message = message;
  broadcast(room);
}

function publicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    food: room.food,
    powerup: room.powerup ? { ...room.powerup } : null,
    countdown: room.countdown ? { ...room.countdown } : null,
    players: room.players.slice().sort((a, b) => a.slot - b.slot).map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      color: p.color,
      score: p.score,
      lives: p.lives,
      snake: p.snake,
      speedBoost: p.speedBoost ? { expiresAt: p.speedBoost.expiresAt } : null
    })),
    winner: room.winner,
    message: room.message
  };
}

function broadcast(room) {
  io.to(room.code).emit('gameState', publicRoomState(room));
}

// Load trivia questions from CSV at startup
const QUESTIONS = loadQuestions();

function loadQuestions() {
  const csvPath = path.join(__dirname, 'data', 'trivia-questions.csv');
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',');
  const questions = [];
  for (let i = 1; i < lines.length; i += 1) {
    const vals = lines[i].split(',');
    const obj = {};
    header.forEach((col, idx) => { obj[col.trim()] = vals[idx]?.trim() || ''; });
    questions.push(obj);
  }
  return questions;
}

function pickQuestion(room) {
  const unused = room.trivia?.usedQuestionIds || [];
  const available = QUESTIONS.filter((q) => !unused.includes(String(q.id)));
  if (available.length === 0) {
    // Wrap around — reset usage
    if (room.trivia) room.trivia.usedQuestionIds = [];
    return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}

function buildTriviaQuestionPayload(question) {
  return {
    questionId: String(question.id),
    question: question.question,
    options: ['a', 'b', 'c', 'd'].map((label) => ({
      label,
      text: question[`option_${label}`]
    })),
    timeLimit: TRIVIA_TIME_SECONDS
  };
}

function clearTrivia(room) {
  if (room.trivia?.timer) clearTimeout(room.trivia.timer);
  room.trivia = null;
}

function triggerTriviaIfReady(room) {
  if (!room.powerup && !room.trivia && room.status === 'playing' && room.foodsEaten >= FOODS_PER_POWERUP) {
    room.foodsEaten = 0;
    startTrivia(room);
    return true;
  }
  return false;
}

function handleTriviaAnswer(room, playerId, label) {
  if (!room || room.status !== 'playing') return false;
  if (!room.trivia || room.trivia.responded.has(playerId)) return false;
  room.trivia.answers[playerId] = label;
  room.trivia.responded.add(playerId);
  if (label === room.trivia.correctLabel) resolveTrivia(room);
  return true;
}

function startTrivia(room) {
  stopLoop(room);
  const question = pickQuestion(room);
  if (!room.trivia) room.trivia = {};
  if (!room.trivia.usedQuestionIds) room.trivia.usedQuestionIds = [];
  room.trivia.usedQuestionIds.push(String(question.id));
  room.trivia.questionId = String(question.id);
  room.trivia.question = question.question;
  room.trivia.correctLabel = question.correct_answer;
  room.trivia.answers = {};
  room.trivia.timer = null;
  room.trivia.responded = new Set();

  io.to(room.code).emit('triviaQuestion', buildTriviaQuestionPayload(question));

  room.trivia.timer = setTimeout(() => resolveTrivia(room), TRIVIA_TIME_SECONDS * 1000);
}

function resolveTrivia(room) {
  if (!room.trivia) return;
  if (room.trivia.timer) {
    clearTimeout(room.trivia.timer);
    room.trivia.timer = null;
  }
  const answers = room.trivia?.answers || {};
  const correctLabel = room.trivia?.correctLabel;

  const correctRespondents = Object.entries(answers)
    .filter(([, label]) => label === correctLabel)
    .map(([playerId]) => playerId);

  let winnerId = null;
  if (correctRespondents.length === 1) {
    winnerId = correctRespondents[0];
  } else if (correctRespondents.length > 1) {
    // All correct — first correct answer wins (earliest timestamp)
    winnerId = correctRespondents[0];
  }
  // If nobody answered correctly → no winner, no powerup

  io.to(room.code).emit('triviaResult', {
    questionId: room.trivia.questionId,
    winnerId,
    correctLabel
  });

  room.powerup = null;

  if (winnerId) {
    const winner = getPlayerById(room, winnerId);
    if (winner) {
      winner.speedBoost = { expiresAt: Date.now() + 15000 };
      io.to(room.code).emit('powerupCollected', { playerId: winner.id, powerupType: 'speed', instant: true });
    }
  }

  room.trivia = null;

  const alive = room.players.filter((p) => p.lives > 0);
  if (alive.length >= MIN_PLAYERS && room.status !== 'ended') {
    room.message = winnerId
      ? `${getPlayerById(room, winnerId)?.name || 'Someone'} won the trivia and gets instant speed boost!`
      : 'No correct answer — no powerup this round.';
    startLoop(room);
    broadcast(room);
  }
}

function getPlayerById(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Snake Clash PvP running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  server,
  rooms,
  _test: {
    createRoom,
    resetRoomForMatch,
    tickRoom,
    startTrivia,
    resolveTrivia,
    handleTriviaAnswer,
    triggerTriviaIfReady,
    clearTrivia,
    buildTriviaQuestionPayload,
    publicRoomState,
    allSnakeCells,
    containsCell,
    sameCell,
    DIRECTIONS,
    constants: {
      GRID_WIDTH,
      GRID_HEIGHT,
      START_LIVES,
      START_LENGTH,
      TICK_MS,
      MIN_PLAYERS,
      MAX_PLAYERS,
      COUNTDOWN_SECONDS,
      TRIVIA_TIME_SECONDS,
      FOODS_PER_POWERUP
    }
  }
};
