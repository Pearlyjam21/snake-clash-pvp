const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const game = fs.readFileSync(path.join(root, 'public', 'game.js'), 'utf8');

function includesAll(source, needles, label) {
  for (const needle of needles) {
    assert(
      source.includes(needle),
      `${label} should include ${JSON.stringify(needle)}`
    );
  }
}

includesAll(html, [
  'fonts.googleapis.com/css2?family=DM+Sans',
  'Same code = same match',
  'Waiting for another snake',
  'How it works',
  'Start playing',
  'countdownOverlay',
  'countdownNumber',
  'controls-card',
  'Arrow keys / WASD',
  'Change trivia answer before time runs out'
], 'index.html');

includesAll(css, [
  '--page-bg: #f7f4ed',
  '--board-bg: #fbf6ea',
  'font-family: \'DM Sans\'',
  '.how-it-works',
  '.player-card.damaged',
  '.countdown-overlay',
  '.countdown-number',
  '.controls-card',
  '.control-pill',
  '@media (prefers-reduced-motion: reduce)'
], 'style.css');

includesAll(game, [
  'formatStatusMessage',
  'drawFood',
  'drawHeadBadge',
  'damagedPlayers',
  'renderCountdown',
  'countdownOverlay',
  'requestAnimationFrame',
  'You won the clash!'
], 'game.js');

assert(!css.includes('color-scheme: dark'), 'redesign should no longer force dark color scheme');
assert(!game.includes('You won. Clean.'), 'winner copy should be friendlier');
console.log('friendly redesign contract ok');
