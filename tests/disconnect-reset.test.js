const assert = require('assert');
const { io } = require('socket.io-client');

const url = process.env.TEST_URL || 'http://localhost:3000';
const room = 'DC' + Math.floor(Math.random() * 100000);
const a = io(url, { transports: ['websocket'] });
const b = io(url, { transports: ['websocket'] });
let bClosed = false;

function cleanup(code = 0) {
  a.close();
  b.close();
  setTimeout(() => process.exit(code), 50);
}

function fail(err) {
  console.error(err && err.stack ? err.stack : err);
  cleanup(1);
}

const timeout = setTimeout(() => fail(new Error('Timed out waiting for disconnect reset contract')), 9000);

a.on('connect_error', fail);
b.on('connect_error', fail);
a.on('joinError', fail);
b.on('joinError', fail);

a.on('gameState', (state) => {
  try {
    if (state.code !== room) return;
    const me = state.players.find((p) => p.name === 'Stay');
    if (!me) return;

    if (!bClosed && state.status === 'playing' && state.players.length === 2) {
      bClosed = true;
      b.close();
      return;
    }

    if (bClosed && state.status === 'waiting' && state.players.length === 1) {
      clearTimeout(timeout);
      assert.strictEqual(me.lives, 3, 'remaining waiting player should be reset to 3 lives after opponent disconnects');
      assert.strictEqual(me.score, 0, 'remaining waiting player score should be reset after opponent disconnects');
      assert.strictEqual(me.snake.length, 4, 'remaining waiting player snake should reset after opponent disconnects');
      console.log('disconnect reset contract ok');
      cleanup(0);
    }
  } catch (error) {
    fail(error);
  }
});

a.on('connect', () => a.emit('joinRoom', { playerName: 'Stay', roomCode: room }));
b.on('connect', () => setTimeout(() => b.emit('joinRoom', { playerName: 'Leave', roomCode: room }), 150));
