const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'public', 'game.js'), 'utf8');

assert(game.includes('shouldIgnoreDirectionKey'), 'game.js should ignore movement hotkeys while typing or using controls');
assert.match(game, /tagName\)\s*\|\|\s*active\.isContentEditable|isContentEditable/, 'movement hotkeys should not block focused inputs/contenteditable fields');
assert(game.includes('triviaHideTimeout'), 'game.js should track trivia result hide timeout');
assert.match(game, /clearTimeout\(triviaHideTimeout\)/, 'new trivia questions should clear stale hide timeout');
assert(game.includes('drawPowerup'), 'game.js should draw visible powerups from public game state');
assert(game.includes('state.powerup'), 'drawGame should use state.powerup');
assert(!game.includes('activeTrivia = data;'), 'client should not store raw trivia payload with hidden/server-only fields');

console.log('frontend regression tests ok');
