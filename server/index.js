const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '../public')));

// ─── Game Constants ───────────────────────────────────────────────────────────
const MAP_W = 2400;
const MAP_H = 1800;
const TILE = 40;
const PLAYER_SPEED = 4;
const BULLET_SPEED = 14;
const PLAYER_RADIUS = 16;
const BULLET_RADIUS = 5;
const MAX_HP = 100;
const FIRE_COOLDOWN = 250; // ms
const ZONE_SHRINK_INTERVAL = 15000; // ms
const ZONE_SHRINK_AMOUNT = 80;
const ZONE_DAMAGE = 2; // per tick outside zone
const TICK_RATE = 60; // fps server tick
const RESPAWN_DELAY = 3000;

// ─── Map Generation ───────────────────────────────────────────────────────────
function generateMap() {
  const walls = [];
  const obstacles = [
    // Border walls
    { x: 0, y: 0, w: MAP_W, h: TILE },
    { x: 0, y: MAP_H - TILE, w: MAP_W, h: TILE },
    { x: 0, y: 0, w: TILE, h: MAP_H },
    { x: MAP_W - TILE, y: 0, w: TILE, h: MAP_H },
  ];

  // Buildings / cover
  const buildings = [
    { x: 200, y: 200, w: 180, h: 120 },
    { x: 500, y: 400, w: 200, h: 140 },
    { x: 900, y: 150, w: 160, h: 160 },
    { x: 1300, y: 300, w: 220, h: 100 },
    { x: 1700, y: 200, w: 180, h: 180 },
    { x: 2000, y: 350, w: 150, h: 150 },
    { x: 300, y: 800, w: 200, h: 120 },
    { x: 700, y: 700, w: 160, h: 200 },
    { x: 1100, y: 800, w: 240, h: 140 },
    { x: 1500, y: 700, w: 180, h: 160 },
    { x: 1900, y: 800, w: 200, h: 120 },
    { x: 200, y: 1300, w: 180, h: 160 },
    { x: 600, y: 1200, w: 200, h: 180 },
    { x: 1000, y: 1300, w: 160, h: 140 },
    { x: 1400, y: 1200, w: 220, h: 160 },
    { x: 1800, y: 1300, w: 180, h: 140 },
    { x: 2100, y: 1100, w: 160, h: 160 },
    // Scattered crates/cover
    { x: 450, y: 600, w: 60, h: 60 },
    { x: 860, y: 500, w: 80, h: 60 },
    { x: 1200, y: 600, w: 60, h: 80 },
    { x: 1600, y: 500, w: 80, h: 60 },
    { x: 750, y: 1000, w: 60, h: 60 },
    { x: 1350, y: 1000, w: 60, h: 60 },
    { x: 1700, y: 1000, w: 80, h: 60 },
    { x: 400, y: 1100, w: 60, h: 80 },
  ];

  return [...obstacles, ...buildings];
}

// ─── Game State ───────────────────────────────────────────────────────────────
let gameState = {
  players: {},
  bullets: [],
  walls: generateMap(),
  zone: { x: MAP_W / 2, y: MAP_H / 2, r: Math.min(MAP_W, MAP_H) * 0.65 },
  nextZone: null,
  phase: 'lobby', // lobby | playing | ended
  shrinkTimer: ZONE_SHRINK_INTERVAL,
  killFeed: [],
  gameTimer: 0,
  winner: null,
};

let bulletIdCounter = 0;
let shrinkPhase = 0;

function resetGame() {
  gameState.bullets = [];
  gameState.walls = generateMap();
  gameState.zone = { x: MAP_W / 2, y: MAP_H / 2, r: Math.min(MAP_W, MAP_H) * 0.65 };
  gameState.nextZone = null;
  gameState.phase = 'playing';
  gameState.shrinkTimer = ZONE_SHRINK_INTERVAL;
  gameState.killFeed = [];
  gameState.gameTimer = 0;
  gameState.winner = null;
  shrinkPhase = 0;

  const spawnPoints = [
    { x: 300, y: 300 }, { x: MAP_W - 300, y: 300 },
    { x: 300, y: MAP_H - 300 }, { x: MAP_W - 300, y: MAP_H - 300 },
    { x: MAP_W / 2, y: 300 }, { x: MAP_W / 2, y: MAP_H - 300 },
    { x: 300, y: MAP_H / 2 }, { x: MAP_W - 300, y: MAP_H / 2 },
    { x: 800, y: 800 }, { x: MAP_W - 800, y: 800 },
    { x: 800, y: MAP_H - 800 }, { x: MAP_W - 800, y: MAP_H - 800 },
  ];

  let spawnIdx = 0;
  for (const [id, player] of Object.entries(gameState.players)) {
    const sp = spawnPoints[spawnIdx % spawnPoints.length];
    spawnIdx++;
    player.x = sp.x + (Math.random() - 0.5) * 200;
    player.y = sp.y + (Math.random() - 0.5) * 200;
    player.hp = MAX_HP;
    player.alive = true;
    player.kills = 0;
    player.vx = 0;
    player.vy = 0;
  }
}

function rectCircleCollide(rx, ry, rw, rh, cx, cy, cr) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

function circleCircleCollide(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2, dy = y1 - y2;
  const dist = dx * dx + dy * dy;
  return dist < (r1 + r2) * (r1 + r2);
}

function addKillFeed(msg) {
  gameState.killFeed.unshift({ msg, time: Date.now() });
  if (gameState.killFeed.length > 6) gameState.killFeed.pop();
}

// ─── Main Game Loop ───────────────────────────────────────────────────────────
const TICK_MS = 1000 / TICK_RATE;

setInterval(() => {
  if (gameState.phase !== 'playing') return;

  const dt = TICK_MS;
  gameState.gameTimer += dt;

  // Zone shrink logic
  gameState.shrinkTimer -= dt;
  if (gameState.shrinkTimer <= 0) {
    shrinkPhase++;
    const newR = Math.max(150, gameState.zone.r - ZONE_SHRINK_AMOUNT - shrinkPhase * 20);
    // Pick new center slightly offset
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 100;
    gameState.nextZone = {
      x: Math.max(newR, Math.min(MAP_W - newR, gameState.zone.x + Math.cos(angle) * dist)),
      y: Math.max(newR, Math.min(MAP_H - newR, gameState.zone.y + Math.sin(angle) * dist)),
      r: newR
    };
    gameState.shrinkTimer = ZONE_SHRINK_INTERVAL;

    // Immediately move zone
    gameState.zone = { ...gameState.nextZone };
    gameState.nextZone = null;
  }

  // Move bullets
  gameState.bullets = gameState.bullets.filter(b => {
    b.x += b.vx;
    b.y += b.vy;
    b.life -= 1;
    if (b.life <= 0) return false;
    if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) return false;

    // Wall collision
    for (const w of gameState.walls) {
      if (b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h) return false;
    }

    // Player collision
    for (const [pid, player] of Object.entries(gameState.players)) {
      if (!player.alive) continue;
      if (pid === b.owner) continue;
      if (circleCircleCollide(b.x, b.y, BULLET_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
        player.hp -= b.damage;
        if (player.hp <= 0) {
          player.alive = false;
          player.hp = 0;
          const killer = gameState.players[b.owner];
          if (killer) {
            killer.kills++;
            addKillFeed(`${killer.name} eliminated ${player.name}`);
          }
          // Schedule respawn data (just mark death time)
          player.deathTime = Date.now();

          // Check win condition
          const alivePlayers = Object.values(gameState.players).filter(p => p.alive);
          if (alivePlayers.length <= 1 && Object.keys(gameState.players).length > 1) {
            if (alivePlayers.length === 1) {
              gameState.winner = alivePlayers[0].name;
              addKillFeed(`👑 ${gameState.winner} WINS!`);
            }
            gameState.phase = 'ended';
            setTimeout(() => {
              // Auto reset after 8s if players still connected
              if (Object.keys(gameState.players).length > 0) {
                resetGame();
                io.emit('gameReset', getSafeState());
              }
            }, 8000);
          }
        }
        return false;
      }
    }
    return true;
  });

  // Move & update players
  for (const [id, player] of Object.entries(gameState.players)) {
    if (!player.alive) {
      // Respawn after delay in lobby-like mode? Just keep dead for now.
      continue;
    }

    let nx = player.x + player.vx;
    let ny = player.y + player.vy;

    // Wall collision
    let blocked = false;
    for (const w of gameState.walls) {
      if (rectCircleCollide(w.x, w.y, w.w, w.h, nx, ny, PLAYER_RADIUS)) {
        // Try sliding
        const canX = !rectCircleCollide(w.x, w.y, w.w, w.h, nx, player.y, PLAYER_RADIUS);
        const canY = !rectCircleCollide(w.x, w.y, w.w, w.h, player.x, ny, PLAYER_RADIUS);
        if (canX) ny = player.y;
        else if (canY) nx = player.x;
        else { nx = player.x; ny = player.y; }
      }
    }

    // Map bounds
    nx = Math.max(PLAYER_RADIUS + TILE, Math.min(MAP_W - PLAYER_RADIUS - TILE, nx));
    ny = Math.max(PLAYER_RADIUS + TILE, Math.min(MAP_H - PLAYER_RADIUS - TILE, ny));

    player.x = nx;
    player.y = ny;

    // Zone damage
    const dx = player.x - gameState.zone.x;
    const dy = player.y - gameState.zone.y;
    if (Math.sqrt(dx * dx + dy * dy) > gameState.zone.r) {
      player.hp -= ZONE_DAMAGE * (dt / 1000) * 10;
      if (player.hp <= 0) {
        player.alive = false;
        player.hp = 0;
        addKillFeed(`${player.name} was eliminated by the zone`);
      }
    }
  }

  // Broadcast
  io.emit('tick', getSafeState());

}, TICK_MS);

function getSafeState() {
  const players = {};
  for (const [id, p] of Object.entries(gameState.players)) {
    players[id] = {
      x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), alive: p.alive,
      name: p.name, color: p.color,
      angle: p.angle, kills: p.kills,
      deathTime: p.deathTime || null
    };
  }
  return {
    players,
    bullets: gameState.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), id: b.id })),
    zone: gameState.zone,
    phase: gameState.phase,
    killFeed: gameState.killFeed,
    gameTimer: Math.round(gameState.gameTimer),
    winner: gameState.winner,
  };
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
const PLAYER_COLORS = ['#FF6B6B','#FFE66D','#4ECDC4','#45B7D1','#96CEB4','#FF9FF3','#54A0FF','#5F27CD','#FF9F43','#00D2D3'];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', ({ name }) => {
    const color = PLAYER_COLORS[Object.keys(gameState.players).length % PLAYER_COLORS.length];
    const spawnX = 300 + Math.random() * (MAP_W - 600);
    const spawnY = 300 + Math.random() * (MAP_H - 600);

    gameState.players[socket.id] = {
      x: spawnX, y: spawnY,
      vx: 0, vy: 0,
      hp: MAX_HP,
      alive: true,
      name: name.slice(0, 16) || 'Player',
      color,
      angle: 0,
      kills: 0,
      lastFire: 0,
    };


    socket.emit('init', {
      id: socket.id,
      walls: gameState.walls,
      mapW: MAP_W,
      mapH: MAP_H,
      ...getSafeState()
    });

    addKillFeed(`${name} joined the game`);
    console.log(`${name} joined. Players: ${Object.keys(gameState.players).length}`);
  });

  socket.on('input', (input) => {
    const player = gameState.players[socket.id];
    if (!player || !player.alive) return;

    // Movement
    let vx = 0, vy = 0;
    if (input.left) vx -= PLAYER_SPEED;
    if (input.right) vx += PLAYER_SPEED;
    if (input.up) vy -= PLAYER_SPEED;
    if (input.down) vy += PLAYER_SPEED;

    // Normalize diagonal
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    player.vx = vx;
    player.vy = vy;
    player.angle = input.angle || 0;

    // Shooting
    if (input.shoot) {
      const now = Date.now();
      if (now - player.lastFire > FIRE_COOLDOWN) {
        player.lastFire = now;
        const angle = input.angle || 0;
        gameState.bullets.push({
          id: bulletIdCounter++,
          x: player.x + Math.cos(angle) * (PLAYER_RADIUS + 8),
          y: player.y + Math.sin(angle) * (PLAYER_RADIUS + 8),
          vx: Math.cos(angle) * BULLET_SPEED,
          vy: Math.sin(angle) * BULLET_SPEED,
          owner: socket.id,
          damage: 20,
          life: 120
        });
      }
    }
  });

  socket.on('startGame', () => {
    if (Object.keys(gameState.players).length >= 1) {
      resetGame();
      io.emit('gameReset', getSafeState());
    }
  });

  socket.on('disconnect', () => {
    const player = gameState.players[socket.id];
    if (player) {
      addKillFeed(`${player.name} left the game`);
      console.log(`${player.name} disconnected`);
    }
    delete gameState.players[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Battle Royale server running on port ${PORT}`);
});
