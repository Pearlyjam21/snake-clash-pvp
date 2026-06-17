const assert = require('assert');
const { io } = require('socket.io-client');

const url = process.env.TEST_URL || 'http://localhost:3000';
const room = 'FP' + Math.floor(Math.random() * 100000);
const clients = Array.from({ length: 4 }, () => io(url, { transports: ['websocket'] }));
const joined = new Set();
const joinErrors = [];
let sawFourPlayers = false;
let sawCountdownOrPlaying = false;
let sawUniqueSlots = false;
let lastState = null;

function cleanup(code = 0) {
  for (const client of clients) client.close();
  setTimeout(() => process.exit(code), 50);
}

function fail(err) {
  console.error(err && err.stack ? err.stack : err);
  if (lastState) {
    console.error('lastState:', JSON.stringify({
      code: lastState.code,
      status: lastState.status,
      players: lastState.players?.map((p) => ({ name: p.name, slot: p.slot, lives: p.lives }))
    }, null, 2));
  }
  cleanup(1);
}

const timeout = setTimeout(() => fail(new Error(`Timed out waiting for four-player room. joined=${joined.size}, errors=${joinErrors.join('|')}`)), 9000);

clients.forEach((client, index) => {
  client.on('connect_error', fail);
  client.on('joinError', (message) => {
    joinErrors.push(`P${index + 1}: ${message}`);
    fail(new Error(`Player ${index + 1} should be allowed into a 4-player room, got joinError: ${message}`));
  });
  client.on('joined', ({ slot }) => {
    joined.add(index);
    assert(slot >= 0 && slot < 4, 'slot should be 0..3');
  });
  client.on('gameState', (state) => {
    if (state.code !== room) return;
    lastState = state;
    const players = state.players || [];
    if (players.length === 4) {
      sawFourPlayers = true;
      const slots = players.map((p) => p.slot);
      sawUniqueSlots = new Set(slots).size === 4;
      assert.deepStrictEqual([...new Set(players.map((p) => p.lives))], [3], 'all four players should start with 3 lives');
      assert(players.every((p) => p.snake.length === 4), 'all four players should start with length 4');
    }
    if (players.length === 4 && state.status === 'playing') {
      sawCountdownOrPlaying = true;
    }
    if (joined.size === 4 && sawFourPlayers && sawUniqueSlots && sawCountdownOrPlaying) {
      clearTimeout(timeout);
      console.log(JSON.stringify({
        ok: true,
        room,
        status: state.status,
        players: players.map((p) => ({ name: p.name, slot: p.slot, lives: p.lives, length: p.snake.length }))
      }, null, 2));
      cleanup(0);
    }
  });
});

clients.forEach((client, index) => {
  client.on('connect', () => {
    setTimeout(() => {
      client.emit('joinRoom', { playerName: `Player ${index + 1}`, roomCode: room });
    }, index * 80);
  });
});
