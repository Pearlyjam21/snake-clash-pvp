const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _test } = require('../server');

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

function makeRoom() {
  const room = _test.createRoom('TRVUNIT');
  room.players = [makePlayer('winner', 0, 7, 11), makePlayer('other', 1, 24, 18, 'left')];
  room.status = 'playing';
  room.food = { x: 20, y: 20 };
  return room;
}

(function validatesTriviaCsv() {
  const qPath = path.join(__dirname, '..', 'data', 'trivia-questions.csv');
  const csv = fs.readFileSync(qPath, 'utf8');
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  assert.deepStrictEqual(header, ['id', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer']);
  assert(lines.length - 1 >= 5, `CSV must have at least 5 questions, got ${lines.length - 1}`);

  const ids = new Set();
  for (const line of lines.slice(1)) {
    const values = line.split(',');
    const row = Object.fromEntries(header.map((name, index) => [name, values[index]]));
    assert(row.id && !ids.has(row.id), `question id should be present and unique: ${row.id}`);
    ids.add(row.id);
    assert(row.question, `question ${row.id} should have text`);
    for (const label of ['a', 'b', 'c', 'd']) assert(row[`option_${label}`], `question ${row.id} option ${label} should be present`);
    assert(['a', 'b', 'c', 'd'].includes(row.correct_answer), `question ${row.id} correct_answer should be a/b/c/d`);
  }
  console.log(`✓ trivia CSV has ${lines.length - 1} questions`);
})();

(function triviaTriggersAfterConfiguredFoodCount() {
  assert.strictEqual(_test.constants.FOODS_PER_POWERUP, 1, 'test mode should trigger trivia/powerup contest after 1 food');

  const room = makeRoom();
  const player = room.players[0];

  room.food = { x: player.snake[0].x + 1, y: player.snake[0].y };
  _test.tickRoom(room);

  assert(room.trivia, 'trivia should start after configured food count is reached');
  assert.strictEqual(room.foodsEaten, 0, 'foodsEaten should reset when trivia starts');
  _test.clearTrivia(room);
})();

(function correctAnswerAppliesSpeedBoostImmediately() {
  const room = makeRoom();
  _test.startTrivia(room);
  const correctLabel = room.trivia.correctLabel;

  const accepted = _test.handleTriviaAnswer(room, 'winner', correctLabel);

  assert.strictEqual(accepted, true, 'correct answer should be accepted');
  assert.strictEqual(room.trivia, null, 'trivia should clear after resolution');
  assert.strictEqual(room.powerup, null, 'correct trivia answer should not create a delayed collectible powerup');
  const winner = room.players.find((p) => p.id === 'winner');
  assert(winner.speedBoost && winner.speedBoost.expiresAt > Date.now(), 'correct answer should immediately grant speed boost');
  const publicState = _test.publicRoomState(room);
  assert(publicState.players.find((p) => p.id === 'winner').speedBoost, 'speed boost should be visible in public player state');
  _test.clearPostTriviaResult(room);
})();

(function correctTriviaAnswerDoesNotResumeLoopUntilResultDelayEnds() {
  const room = makeRoom();
  _test.startTrivia(room);
  const correctLabel = room.trivia.correctLabel;

  const beforeAnswer = Date.now();
  const accepted = _test.handleTriviaAnswer(room, 'winner', correctLabel);

  assert.strictEqual(accepted, true, 'correct answer should be accepted');
  assert.strictEqual(room.trivia, null, 'trivia should resolve immediately');
  assert(room.postTriviaResult, 'room should enter a post-trivia result pause');
  assert.strictEqual(room.interval, null, 'game loop must not restart while trivia result overlay is visible');
  assert(
    room.postTriviaResult.resumesAt - beforeAnswer >= _test.constants.TRIVIA_RESULT_SECONDS * 1000 + _test.constants.TRIVIA_RESUME_BUFFER_MS,
    'server resume should include a safety buffer after the client result display window'
  );

  _test.resumeAfterTriviaResult(room);

  assert.strictEqual(room.postTriviaResult, null, 'manual resume should clear post-trivia pause state');
  assert(room.interval, 'game loop should restart only after result delay completes');
  _test.stopLoop(room);
})();

(function playerCanChangeWrongTriviaAnswerBeforeCorrectResolution() {
  const room = makeRoom();
  _test.startTrivia(room);
  const correctLabel = room.trivia.correctLabel;
  const wrongLabel = ['a', 'b', 'c', 'd'].find((label) => label !== correctLabel);

  assert.strictEqual(_test.handleTriviaAnswer(room, 'winner', wrongLabel), true, 'wrong answer should be recorded');
  assert(room.trivia, 'wrong answer should not resolve trivia immediately');
  assert.strictEqual(room.trivia.answers.winner, wrongLabel, 'wrong answer should be stored');

  assert.strictEqual(_test.handleTriviaAnswer(room, 'winner', correctLabel), true, 'changed correct answer should be accepted');
  assert.strictEqual(room.trivia, null, 'changed correct answer should resolve trivia');
  const winner = room.players.find((p) => p.id === 'winner');
  assert(winner.speedBoost && winner.speedBoost.expiresAt > Date.now(), 'changed correct answer should grant boost');
  _test.clearPostTriviaResult(room);
})();

(function questionPayloadHidesCorrectAnswerUntilResult() {
  const payload = _test.buildTriviaQuestionPayload({
    id: 99,
    question: 'Pick B',
    option_a: 'A',
    option_b: 'B',
    option_c: 'C',
    option_d: 'D',
    correct_answer: 'b'
  });
  assert(!Object.prototype.hasOwnProperty.call(payload, 'correctLabel'), 'triviaQuestion payload must not reveal the correct answer');
})();

console.log('powerup trivia tests ok');
