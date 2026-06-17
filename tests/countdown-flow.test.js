const assert = require('assert');
const { io } = require('socket.io-client');

const url = process.env.TEST_URL || 'http://localhost:3000';
const room = 'CD' + Math.floor(Math.random() * 100000);
const a = io(url, { transports: ['websocket'] });
const b = io(url, { transports: ['websocket'] });

let sawWaiting = false;
let sawStartCountdown = false;
let sawPlayingAfterStart = false;
let sawLifeLoss = false;
let sawRespawnCountdown = false;
let sawPlayingAfterRespawn = false;
let startCountdownValues = new Set();
let respawnCountdownValues = new Set();

function cleanup(code = 0) {
  a.close();
  b.close();
  setTimeout(() => process.exit(code), 50);
}

function fail(err) {
  console.error(err && err.stack ? err.stack : err);
  cleanup(1);
}

const timeout = setTimeout(() => fail(new Error('Timed out waiting for countdown flow')), 13000);

for (const client of [a, b]) {
  client.on('connect_error', fail);
  client.on('joinError', fail);
  client.on('gameState', (state) => {
    if (state.code !== room) return;

    if (state.status === 'waiting') sawWaiting = true;

    if (state.status === 'playing' && !sawStartCountdown) {
      fail(new Error('Game entered playing before start countdown was observed'));
      return;
    }

    if (state.status === 'countdown' && state.countdown?.phase === 'start') {
      sawStartCountdown = true;
      startCountdownValues.add(state.countdown.value);
      assert(state.countdown.value >= 1 && state.countdown.value <= 3, 'start countdown value should be 1..3');
      assert.match(state.countdown.message, /starts/i);
    }

    if (state.status === 'playing' && sawStartCountdown && !sawLifeLoss) {
      sawPlayingAfterStart = true;
    }

    if (state.players?.some((p) => p.lives < 3)) {
      sawLifeLoss = true;
    }

    if (state.status === 'countdown' && state.countdown?.phase === 'respawn') {
      sawRespawnCountdown = true;
      respawnCountdownValues.add(state.countdown.value);
      assert(state.players.some((p) => p.lives === 2), 'respawn countdown should happen after life loss');
      assert.match(state.countdown.message, /respawn/i);
    }

    if (state.status === 'playing' && sawRespawnCountdown && state.players.some((p) => p.lives === 2)) {
      sawPlayingAfterRespawn = true;
    }

    if (sawWaiting && sawStartCountdown && sawPlayingAfterStart && sawLifeLoss && sawRespawnCountdown && sawPlayingAfterRespawn) {
      clearTimeout(timeout);
      try {
        assert(startCountdownValues.has(3), 'start countdown should include 3');
        assert(respawnCountdownValues.has(3), 'respawn countdown should include 3');
        console.log(JSON.stringify({
          ok: true,
          room,
          sawWaiting,
          sawStartCountdown,
          sawPlayingAfterStart,
          sawLifeLoss,
          sawRespawnCountdown,
          sawPlayingAfterRespawn,
          startCountdownValues: [...startCountdownValues].sort(),
          respawnCountdownValues: [...respawnCountdownValues].sort()
        }, null, 2));
        cleanup(0);
      } catch (error) {
        fail(error);
      }
    }
  });
}

a.on('connect', () => a.emit('joinRoom', { playerName: 'Count A', roomCode: room }));
b.on('connect', () => setTimeout(() => b.emit('joinRoom', { playerName: 'Count B', roomCode: room }), 150));
