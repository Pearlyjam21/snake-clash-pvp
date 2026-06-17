# Snake Clash PvP

Local 2–4 player multiplayer Snake Battle built with Node.js, Express, Socket.io, HTML, CSS, JavaScript, and Canvas.

## Features

- Two to four players join the same room code.
- Player name and room code inputs.
- Waiting screen until at least two players join.
- Room supports up to four player slots.
- Server-authoritative start countdown before gameplay.
- Server-authoritative respawn countdown after non-final life loss.
- Canvas-rendered game board.
- One controllable snake per player.
- Random food spawning away from snakes.
- Eating food increases score and snake length.
- Each player starts with 3 lives.
- Wall, own-body, and enemy-body collisions cost 1 life and trigger respawn.
- Multi-snake head collisions punish the shortest snake; equal shortest length damages all tied shortest snakes.
- Scoreboard with score, lives, and length.
- Winner overlay and restart button.

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

To test multiplayer locally, open two to four browser tabs or browser windows, enter different player names, and use the same room code.

## Controls

- Arrow keys: move
- WASD: move

Each browser controls only its own snake.

## Deployment

This is a standard Node.js web app.

1. Install Node.js 18+ on the target server.
2. Copy the project folder to the server.
3. Run `npm install --omit=dev`.
4. Set the port if needed:

   ```bash
   PORT=3000 npm start
   ```

5. Put a reverse proxy such as Nginx/Caddy in front if deploying publicly.
6. Ensure WebSocket upgrade headers are enabled for Socket.io.

Example Nginx location block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## Project structure

```text
snake-clash-pvp/
├── server.js
├── package.json
├── README.md
└── public/
    ├── index.html
    ├── style.css
    └── game.js
```
