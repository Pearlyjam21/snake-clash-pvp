const { spawn } = require('child_process');
const { server, rooms } = require('../server');

const tests = [
  'tests/redesign-contract.test.js',
  'tests/frontend-regression.test.js',
  'tests/gameplay-regression.test.js',
  'tests/disconnect-reset.test.js',
  'tests/countdown-flow.test.js',
  'tests/four-player-room.test.js',
  'tests/powerup-trivia.test.js'
];

function runTest(testFile, testUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [testFile], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', TEST_URL: testUrl },
      stdio: 'inherit'
    });
    child.on('close', (code) => resolve(code));
  });
}

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const testUrl = `http://127.0.0.1:${port}`;
  let failed = false;

  for (const testFile of tests) {
    rooms.clear();
    const code = await runTest(testFile, testUrl);
    if (code !== 0) {
      failed = true;
      break;
    }
  }

  server.close(() => process.exit(failed ? 1 : 0));
});
