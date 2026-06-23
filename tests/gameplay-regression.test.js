const assert = require('assert');
const { _test } = require('../server');

assert(_test, 'server should export _test internals for deterministic gameplay regression tests');

function makePlayer(id, slot, x, y, direction = 'right') {
  const back = {
    right: { x: -1, y: 0 },
    left: { x: 1, y: 0 },
    down: { x: 0, y: -1 },
    up: { x: 0, y: 1 }
  }[direction];
  return {
    id,
    name: id,
    slot,
    color: '#fff',
    score: 0,
    lives: 3,
    direction,
    nextDirection: direction,
    snake: [
      { x, y },
      { x: x + back.x, y: y + back.y },
      { x: x + back.x * 2, y: y + back.y * 2 },
      { x: x + back.x * 3, y: y + back.y * 3 }
    ]
  };
}

function makeRoom(players) {
  const room = _test.createRoom('UNIT');
  room.players = players;
  room.status = 'playing';
  return room;
}

(function boostedSecondStepFoodRespawnsAwayFromSnake() {
  const player = makePlayer('boosted', 0, 7, 11, 'right');
  player.speedBoost = { expiresAt: Date.now() + 10000 };
  const other = makePlayer('other', 1, 24, 18, 'left');
  const room = makeRoom([player, other]);
  room.food = { x: 9, y: 11 };

  _test.tickRoom(room);

  assert.strictEqual(player.score, 1, 'boosted player should eat food on second movement cell');
  assert.strictEqual(player.snake[0].x, 9, 'boosted player should advance two cells');
  assert(!_test.containsCell(_test.allSnakeCells(room.players), room.food), 'food should respawn away from snake cells after boosted second-step eat');
})();

(function boostedSecondStepPowerupIsCollected() {
  const player = makePlayer('boosted', 0, 7, 11, 'right');
  player.speedBoost = { expiresAt: Date.now() + 10000 };
  const other = makePlayer('other', 1, 24, 18, 'left');
  const room = makeRoom([player, other]);
  room.food = { x: 20, y: 20 };
  room.powerup = { x: 9, y: 11, type: 'speed' };

  _test.tickRoom(room);

  assert.strictEqual(room.powerup, null, 'boosted player should collect powerup on second movement cell');
  assert(player.speedBoost && player.speedBoost.expiresAt > Date.now(), 'powerup collection should grant/refresh speed boost');
})();

(function resolvingClearedTriviaDoesNotThrow() {
  const room = makeRoom([makePlayer('a', 0, 7, 11), makePlayer('b', 1, 24, 18, 'left')]);
  _test.startTrivia(room);
  _test.clearTrivia(room);

  assert.doesNotThrow(() => _test.resolveTrivia(room), 'stale trivia timer callback after cleanup should not crash server');
})();

(function foodEatenDuringRespawnGraceTriggersTriviaImmediately() {
  const player = makePlayer('grace', 0, 7, 11, 'right');
  const other = makePlayer('other', 1, 24, 18, 'left');
  const room = makeRoom([player, other]);
  room.graceTicks = 5;
  room.food = { x: 8, y: 11 };

  _test.tickRoom(room);

  assert(room.trivia, 'eating food during respawn grace should start trivia immediately, not after grace/death');
  assert.strictEqual(room.foodsEaten, 0, 'foodsEaten should reset when grace food triggers trivia');
  _test.clearTrivia(room);
})();

(function speedBoostMovesTwoCellsDuringRespawnGrace() {
  const player = makePlayer('boosted', 0, 7, 11, 'right');
  const other = makePlayer('other', 1, 24, 18, 'left');
  const room = makeRoom([player, other]);
  room.graceTicks = 5;
  player.speedBoost = { expiresAt: Date.now() + 15000 };
  room.food = { x: 20, y: 20 };

  _test.tickRoom(room);

  assert.deepStrictEqual(player.snake[0], { x: 9, y: 11 }, 'boosted player should advance two cells even during grace');
  assert.strictEqual(room.graceTicks, 4, 'grace should still decrement once per tick');
})();

(function triviaQuestionPayloadDoesNotExposeCorrectAnswer() {
  const question = {
    id: 'q1',
    question: 'Question?',
    option_a: 'A',
    option_b: 'B',
    option_c: 'C',
    option_d: 'D',
    correct_answer: 'b'
  };
  const payload = _test.buildTriviaQuestionPayload(question);
  assert.strictEqual(payload.correctLabel, undefined, 'question payload should not expose correct answer before result');
  assert.strictEqual(payload.questionId, 'q1');
  assert.strictEqual(payload.options.length, 4);
})();

(function publicStateIncludesPowerupForRendering() {
  const room = makeRoom([makePlayer('a', 0, 7, 11), makePlayer('b', 1, 24, 18, 'left')]);
  room.powerup = { x: 12, y: 11, type: 'speed' };
  const state = _test.publicRoomState(room);
  assert.deepStrictEqual(state.powerup, room.powerup, 'public state should include powerup coordinates so clients can draw it');
})();

(function postRespawnWallCollisionCostsLifeImmediately() {
  const player = makePlayer('wall', 0, _test.constants.GRID_WIDTH - 1, 11, 'right');
  const other = makePlayer('other', 1, 24, 18, 'left');
  const room = makeRoom([player, other]);
  room.food = { x: 20, y: 20 };

  _test.tickRoom(room);
  assert.strictEqual(player.lives, 2, 'first wall collision should cost one life and respawn the player');
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }

  room.status = 'playing';
  room.countdown = null;
  player.direction = 'right';
  player.nextDirection = 'right';
  player.snake = [
    { x: _test.constants.GRID_WIDTH - 1, y: 11 },
    { x: _test.constants.GRID_WIDTH - 2, y: 11 },
    { x: _test.constants.GRID_WIDTH - 3, y: 11 },
    { x: _test.constants.GRID_WIDTH - 4, y: 11 }
  ];

  _test.tickRoom(room);

  assert.strictEqual(player.lives, 1, 'wall collision after respawn should cost a life immediately, not wait for graceTicks to expire');
})();

console.log('gameplay regression tests ok');
