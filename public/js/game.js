// ─── ZONE — Retro Battle Royale Client ───────────────────────────────────────

const socket = io();

// DOM
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const lobby = document.getElementById('lobby');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const connecting = document.getElementById('connecting');

// Game state
let myId = null;
let gameData = null;
let walls = [];
let MAP_W = 2400, MAP_H = 1800;
let cameraX = 0, cameraY = 0;
let mouseX = 0, mouseY = 0;
let worldMouseX = 0, worldMouseY = 0;
let shooting = false;
let joined = false;
let myName = '';

// Particle system
const particles = [];

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = { left: false, right: false, up: false, down: false };

function isTyping() {
  const tag = document.activeElement && document.activeElement.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

window.addEventListener('keydown', e => {
  if (isTyping()) return;
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': keys.left  = true; e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': keys.right = true; e.preventDefault(); break;
    case 'ArrowUp':    case 'KeyW': keys.up    = true; e.preventDefault(); break;
    case 'ArrowDown':  case 'KeyS': keys.down  = true; e.preventDefault(); break;
  }
});
window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': keys.left  = false; break;
    case 'ArrowRight': case 'KeyD': keys.right = false; break;
    case 'ArrowUp':    case 'KeyW': keys.up    = false; break;
    case 'ArrowDown':  case 'KeyS': keys.down  = false; break;
  }
});

window.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  worldMouseX = mouseX + cameraX;
  worldMouseY = mouseY + cameraY;
});

window.addEventListener('mousedown', e => { if (e.button === 0 && joined) shooting = true; });
window.addEventListener('mouseup',   e => { if (e.button === 0) shooting = false; });
window.addEventListener('contextmenu', e => { if (joined) e.preventDefault(); });

// ─── Socket Events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  connecting.style.display = 'none';
});

socket.on('init', (data) => {
  myId = data.id;
  walls = data.walls;
  MAP_W = data.mapW;
  MAP_H = data.mapH;
  gameData = data;
  updateHUD(data);
});

socket.on('tick', (data) => {
  const prev = gameData;
  gameData = data;

  // Detect new bullet hits (particles)
  if (prev && data.bullets) {
    const prevIds = new Set((prev.bullets || []).map(b => b.id));
    const curIds = new Set(data.bullets.map(b => b.id));
    // bullets that disappeared = hit something
    for (const pb of (prev.bullets || [])) {
      if (!curIds.has(pb.id)) {
        spawnParticles(pb.x, pb.y, '#ffcc00', 6);
      }
    }
  }

  // Detect player deaths
  if (prev && prev.players) {
    for (const [id, p] of Object.entries(data.players)) {
      const pp = prev.players[id];
      if (pp && pp.alive && !p.alive) {
        spawnParticles(p.x, p.y, p.color, 20);
      }
    }
  }

  updateHUD(data);
});

socket.on('gameReset', (data) => {
  gameData = data;
  overlay.classList.remove('show');
  updateHUD(data);
});

// ─── Particles ────────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1, decay: 0.04 + Math.random() * 0.04,
      color, size: 2 + Math.random() * 4
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.1;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
let lastKillFeed = [];

function updateHUD(data) {
  if (!myId || !data.players[myId]) return;
  const me = data.players[myId];

  // HP
  const hp = Math.max(0, me.hp);
  document.getElementById('hpBar').style.width = hp + '%';
  document.getElementById('hpBar').style.background = hp > 50 ? '#44ffaa' : hp > 25 ? '#ffcc00' : '#ff4444';
  document.getElementById('hpText').textContent = Math.round(hp);
  document.getElementById('killCount').textContent = me.kills || 0;

  // Alive count
  const alive = Object.values(data.players).filter(p => p.alive).length;
  const total = Object.keys(data.players).length;
  document.getElementById('aliveCount').textContent = `${alive}/${total} ALIVE`;

  // Zone timer
  document.getElementById('zoneTimer').textContent = data.phase === 'playing' ? '⚠ ZONE ACTIVE' : data.phase.toUpperCase();

  // Kill feed
  const kf = document.getElementById('killfeed');
  if (JSON.stringify(data.killFeed) !== JSON.stringify(lastKillFeed)) {
    lastKillFeed = [...(data.killFeed || [])];
    kf.innerHTML = '';
    (data.killFeed || []).forEach(item => {
      const div = document.createElement('div');
      div.className = 'kf-item';
      div.textContent = item.msg;
      kf.appendChild(div);
    });
  }

  // Death / win overlay
  if (!me.alive && data.phase === 'playing') {
    overlay.classList.add('show');
    document.getElementById('overlayTitle').textContent = 'YOU DIED';
    document.getElementById('overlayTitle').style.color = '#ff4444';
    document.getElementById('overlaySub').textContent = `${me.kills || 0} kills`;
  } else if (data.phase === 'ended') {
    overlay.classList.add('show');
    if (data.winner === me.name) {
      document.getElementById('overlayTitle').textContent = '👑 VICTORY';
      document.getElementById('overlayTitle').style.color = '#ffcc00';
      document.getElementById('overlaySub').textContent = 'you are the last one standing!';
    } else {
      document.getElementById('overlayTitle').textContent = 'GAME OVER';
      document.getElementById('overlayTitle').style.color = '#ff6666';
      document.getElementById('overlaySub').textContent = `${data.winner || 'nobody'} won`;
    }
  } else {
    if (me.alive) overlay.classList.remove('show');
  }
}

// ─── Input Loop ───────────────────────────────────────────────────────────────
setInterval(() => {
  if (!myId || !joined) return;
  const me = gameData?.players?.[myId];
  if (!me || !me.alive) return;

  const angle = Math.atan2(worldMouseY - me.y, worldMouseX - me.x);

  socket.emit('input', {
    left: keys.left,
    right: keys.right,
    up: keys.up,
    down: keys.down,
    angle,
    shoot: shooting
  });
}, 1000 / 60);

// ─── Rendering ────────────────────────────────────────────────────────────────

// Pixel font helper
function pixelText(text, x, y, size, color, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${size}px 'Press Start 2P', monospace`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function vtText(text, x, y, size, color, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${size}px 'VT323', monospace`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

// Tile colors for ground
const GROUND_COLORS = ['#1a1a2e', '#16213e', '#1a1a2e'];

function drawBackground() {
  const TILE = 80;
  const startX = Math.floor(cameraX / TILE) * TILE;
  const startY = Math.floor(cameraY / TILE) * TILE;

  for (let x = startX; x < cameraX + canvas.width + TILE; x += TILE) {
    for (let y = startY; y < cameraY + canvas.height + TILE; y += TILE) {
      const idx = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2;
      ctx.fillStyle = idx === 0 ? '#0f0f1a' : '#111124';
      ctx.fillRect(x - cameraX, y - cameraY, TILE, TILE);
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(42,42,58,0.5)';
  ctx.lineWidth = 0.5;
  for (let x = startX; x < cameraX + canvas.width + TILE; x += TILE) {
    ctx.beginPath();
    ctx.moveTo(x - cameraX, 0);
    ctx.lineTo(x - cameraX, canvas.height);
    ctx.stroke();
  }
  for (let y = startY; y < cameraY + canvas.height + TILE; y += TILE) {
    ctx.beginPath();
    ctx.moveTo(0, y - cameraY);
    ctx.lineTo(canvas.width, y - cameraY);
    ctx.stroke();
  }
}

function drawWalls() {
  for (const w of walls) {
    const sx = w.x - cameraX, sy = w.y - cameraY;
    if (sx > canvas.width || sy > canvas.height || sx + w.w < 0 || sy + w.h < 0) continue;

    // Determine if it's a border or building
    const isBorder = w.x === 0 || w.y === 0 || w.x + w.w === MAP_W || w.y + w.h === MAP_H;
    const isSmall = w.w <= 80 && w.h <= 80;

    if (isBorder) {
      ctx.fillStyle = '#2a2a3a';
      ctx.fillRect(sx, sy, w.w, w.h);
    } else if (isSmall) {
      // Crate
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(sx, sy, w.w, w.h);
      ctx.strokeStyle = '#8b5e3c';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 2, sy + 2, w.w - 4, w.h - 4);
      // X mark on crate
      ctx.strokeStyle = '#6b4e2c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + 6, sy + 6); ctx.lineTo(sx + w.w - 6, sy + w.h - 6);
      ctx.moveTo(sx + w.w - 6, sy + 6); ctx.lineTo(sx + 6, sy + w.h - 6);
      ctx.stroke();
    } else {
      // Building
      ctx.fillStyle = '#1e2035';
      ctx.fillRect(sx, sy, w.w, w.h);
      ctx.strokeStyle = '#3a3a5a';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, w.w, w.h);
      // Window dots
      ctx.fillStyle = 'rgba(255,220,100,0.3)';
      const wSize = 8;
      const wGap = 24;
      for (let wx = sx + 16; wx < sx + w.w - 16; wx += wGap) {
        for (let wy = sy + 16; wy < sy + w.h - 16; wy += wGap) {
          ctx.fillRect(wx, wy, wSize, wSize);
        }
      }
      // Roof line
      ctx.strokeStyle = '#4a4a6a';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 4, sy + 4, w.w - 8, w.h - 8);
    }
  }
}

function drawZone(zone) {
  if (!zone) return;
  const sx = zone.x - cameraX;
  const sy = zone.y - cameraY;

  // Outside zone — red vignette overlay
  ctx.save();
  ctx.fillStyle = 'rgba(255, 30, 30, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Cut out safe zone
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(sx, sy, zone.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fill();
  ctx.restore();

  // Zone border
  ctx.save();
  ctx.strokeStyle = `rgba(255, 50, 50, ${0.5 + 0.3 * Math.sin(Date.now() / 400)})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.lineDashOffset = -(Date.now() / 20) % 20;
  ctx.beginPath();
  ctx.arc(sx, sy, zone.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBullets() {
  if (!gameData?.bullets) return;
  for (const b of gameData.bullets) {
    const sx = b.x - cameraX, sy = b.y - cameraY;
    ctx.save();
    ctx.fillStyle = '#ffcc00';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ffcc00';
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayers() {
  if (!gameData?.players) return;
  for (const [id, p] of Object.entries(gameData.players)) {
    if (!p.alive) continue;
    const sx = p.x - cameraX, sy = p.y - cameraY;
    const isMe = id === myId;
    const angle = p.angle || 0;

    ctx.save();
    ctx.translate(sx, sy);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = p.color;
    if (isMe) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = p.color;
    }
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = isMe ? 2 : 1;
    ctx.stroke();

    // Face / direction indicator
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();

    // Gun barrel
    ctx.rotate(angle);
    ctx.fillStyle = isMe ? '#ffffff' : 'rgba(255,255,255,0.7)';
    ctx.fillRect(6, -3, 18, 6);
    // Gun detail
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(10, -1, 14, 2);

    ctx.restore();

    // Name tag
    ctx.save();
    ctx.font = "13px 'VT323', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - 30, sy - 34, 60, 16);
    ctx.fillStyle = isMe ? '#ffcc00' : '#e8e8ff';
    ctx.fillText(p.name, sx, sy - 22);
    ctx.restore();

    // HP bar above player
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - 20, sy - 44, 40, 5);
    ctx.fillStyle = p.hp > 50 ? '#44ffaa' : p.hp > 25 ? '#ffcc00' : '#ff4444';
    ctx.fillRect(sx - 20, sy - 44, (p.hp / 100) * 40, 5);
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 4;
    ctx.shadowColor = p.color;
    ctx.beginPath();
    ctx.arc(p.x - cameraX, p.y - cameraY, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawMinimap() {
  const W = minimap.width, H = minimap.height;
  const scaleX = W / MAP_W, scaleY = H / MAP_H;

  mmCtx.fillStyle = 'rgba(10,10,20,0.9)';
  mmCtx.fillRect(0, 0, W, H);

  // Walls
  mmCtx.fillStyle = '#2a2a4a';
  for (const w of walls) {
    mmCtx.fillRect(w.x * scaleX, w.y * scaleY, Math.max(1, w.w * scaleX), Math.max(1, w.h * scaleY));
  }

  // Zone
  if (gameData?.zone) {
    const z = gameData.zone;
    mmCtx.strokeStyle = 'rgba(255,50,50,0.8)';
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.arc(z.x * scaleX, z.y * scaleY, z.r * scaleX, 0, Math.PI * 2);
    mmCtx.stroke();
  }

  // Players
  if (gameData?.players) {
    for (const [id, p] of Object.entries(gameData.players)) {
      if (!p.alive) continue;
      mmCtx.fillStyle = id === myId ? '#ffffff' : p.color;
      mmCtx.beginPath();
      mmCtx.arc(p.x * scaleX, p.y * scaleY, id === myId ? 4 : 2.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
  }

  // Camera view rectangle
  mmCtx.strokeStyle = 'rgba(255,255,255,0.2)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(
    cameraX * scaleX, cameraY * scaleY,
    canvas.width * scaleX, canvas.height * scaleY
  );
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!joined || !myId || !gameData) return;

  const me = gameData.players?.[myId];

  // Camera follows player (or last known pos)
  if (me) {
    const targetX = me.x - canvas.width / 2;
    const targetY = me.y - canvas.height / 2;
    cameraX += (targetX - cameraX) * 0.1;
    cameraY += (targetY - cameraY) * 0.1;
    cameraX = Math.max(0, Math.min(MAP_W - canvas.width, cameraX));
    cameraY = Math.max(0, Math.min(MAP_H - canvas.height, cameraY));
    worldMouseX = mouseX + cameraX;
    worldMouseY = mouseY + cameraY;
  }

  updateParticles();

  // Draw
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawZone(gameData.zone);
  drawWalls();
  drawParticles();
  drawBullets();
  drawPlayers();

  // Crosshair
  if (me?.alive) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    const cs = 10, cg = 4;
    ctx.beginPath();
    ctx.moveTo(mouseX - cs - cg, mouseY); ctx.lineTo(mouseX - cg, mouseY);
    ctx.moveTo(mouseX + cg, mouseY); ctx.lineTo(mouseX + cs + cg, mouseY);
    ctx.moveTo(mouseX, mouseY - cs - cg); ctx.lineTo(mouseX, mouseY - cg);
    ctx.moveTo(mouseX, mouseY + cg); ctx.lineTo(mouseX, mouseY + cs + cg);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.restore();
  }

  drawMinimap();
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
document.getElementById('joinBtn').addEventListener('click', joinGame);
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinGame();
});
document.getElementById('restartBtn').addEventListener('click', () => {
  socket.emit('startGame');
  overlay.classList.remove('show');
});

function joinGame() {
  const name = document.getElementById('nameInput').value.trim() || 'PLAYER';
  myName = name;
  socket.emit('join', { name });
  lobby.style.display = 'none';
  hud.style.display = 'flex';
  joined = true;
  // Blur any focused element so keyboard events go to window
  document.activeElement && document.activeElement.blur();
}

// Auto-focus name input on load
window.addEventListener('load', () => {
  document.getElementById('nameInput').focus();
});

// Start loop
gameLoop();
