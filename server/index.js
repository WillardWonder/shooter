const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../public')));

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_W = 2400, MAP_H = 1800, TILE = 40;
const PLAYER_RADIUS = 16, BULLET_RADIUS = 5;
const MAX_HP = 100, MAX_SHIELD = 50;
const ZONE_SHRINK_INTERVAL = 20000;
const ZONE_SHRINK_AMOUNT = 100;
const ZONE_DAMAGE = 15;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const LOOT_PICKUP_RADIUS = 32;
const LOOT_SPAWN_COUNT = 45;

// ─── Weapon Definitions ───────────────────────────────────────────────────────
const WEAPONS = {
  pistol:  { name:'Pistol',  emoji:'🔫', color:'#aaaaaa', damage:18, fireRate:400,  bulletSpeed:14, bulletLife:100, spread:0.04,  bullets:1, ammo:30, rarity:'common'   },
  shotgun: { name:'Shotgun', emoji:'💥', color:'#cc8844', damage:14, fireRate:800,  bulletSpeed:11, bulletLife:60,  spread:0.22,  bullets:5, ammo:16, rarity:'uncommon'  },
  smg:     { name:'SMG',     emoji:'⚡', color:'#44aaff', damage:12, fireRate:120,  bulletSpeed:15, bulletLife:90,  spread:0.08,  bullets:1, ammo:60, rarity:'uncommon'  },
  rifle:   { name:'Rifle',   emoji:'🎯', color:'#44ff88', damage:35, fireRate:600,  bulletSpeed:20, bulletLife:130, spread:0.01,  bullets:1, ammo:20, rarity:'rare'      },
  sniper:  { name:'Sniper',  emoji:'🔭', color:'#ff44ff', damage:80, fireRate:1500, bulletSpeed:28, bulletLife:200, spread:0.005, bullets:1, ammo:8,  rarity:'epic'      },
  rocket:  { name:'Rocket',  emoji:'🚀', color:'#ff4400', damage:70, fireRate:2000, bulletSpeed:9,  bulletLife:180, spread:0.02,  bullets:1, ammo:4,  rarity:'epic', splash:80 },
};

// ─── Loot Table ───────────────────────────────────────────────────────────────
const LOOT_TABLE = [
  { key:'pistol',  type:'weapon', weapon:'pistol',  rarity:'common',   color:'#aaaaaa', weight:30 },
  { key:'shotgun', type:'weapon', weapon:'shotgun', rarity:'uncommon', color:'#cc8844', weight:18 },
  { key:'smg',     type:'weapon', weapon:'smg',     rarity:'uncommon', color:'#44aaff', weight:18 },
  { key:'rifle',   type:'weapon', weapon:'rifle',   rarity:'rare',     color:'#44ff88', weight:10 },
  { key:'sniper',  type:'weapon', weapon:'sniper',  rarity:'epic',     color:'#ff44ff', weight:5  },
  { key:'rocket',  type:'weapon', weapon:'rocket',  rarity:'epic',     color:'#ff4400', weight:4  },
  { key:'medkit',  type:'heal',   amount:50,        rarity:'uncommon', color:'#ff4466', emoji:'❤️',  weight:15 },
  { key:'bandage', type:'heal',   amount:20,        rarity:'common',   color:'#ff8899', emoji:'🩹',  weight:25 },
  { key:'shield',  type:'shield', amount:50,        rarity:'rare',     color:'#4488ff', emoji:'🛡️', weight:12 },
  { key:'ammo',    type:'ammo',   amount:30,        rarity:'common',   color:'#ffcc44', emoji:'📦',  weight:30 },
];

function randomLoot() {
  const total = LOOT_TABLE.reduce((s, l) => s + l.weight, 0);
  let r = Math.random() * total;
  for (const l of LOOT_TABLE) { r -= l.weight; if (r <= 0) return { ...l }; }
  return { ...LOOT_TABLE[0] };
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function generateMap() {
  return [
    { x:0, y:0, w:MAP_W, h:TILE }, { x:0, y:MAP_H-TILE, w:MAP_W, h:TILE },
    { x:0, y:0, w:TILE, h:MAP_H }, { x:MAP_W-TILE, y:0, w:TILE, h:MAP_H },
    { x:200,y:200,w:180,h:120 }, { x:500,y:400,w:200,h:140 },
    { x:900,y:150,w:160,h:160 }, { x:1300,y:300,w:220,h:100 },
    { x:1700,y:200,w:180,h:180 }, { x:2000,y:350,w:150,h:150 },
    { x:300,y:800,w:200,h:120 }, { x:700,y:700,w:160,h:200 },
    { x:1100,y:800,w:240,h:140 }, { x:1500,y:700,w:180,h:160 },
    { x:1900,y:800,w:200,h:120 }, { x:200,y:1300,w:180,h:160 },
    { x:600,y:1200,w:200,h:180 }, { x:1000,y:1300,w:160,h:140 },
    { x:1400,y:1200,w:220,h:160 }, { x:1800,y:1300,w:180,h:140 },
    { x:2100,y:1100,w:160,h:160 },
    { x:450,y:600,w:60,h:60 }, { x:860,y:500,w:80,h:60 },
    { x:1200,y:600,w:60,h:80 }, { x:1600,y:500,w:80,h:60 },
    { x:750,y:1000,w:60,h:60 }, { x:1350,y:1000,w:60,h:60 },
    { x:1700,y:1000,w:80,h:60 }, { x:400,y:1100,w:60,h:80 },
  ];
}

function spawnLoot() {
  const items = [];
  for (let i = 0; i < LOOT_SPAWN_COUNT; i++) {
    const def = randomLoot();
    items.push({
      ...def,
      id: `loot_${i}_${Date.now()}`,
      x: TILE * 2 + Math.random() * (MAP_W - TILE * 4),
      y: TILE * 2 + Math.random() * (MAP_H - TILE * 4),
    });
  }
  return items;
}

// ─── State ────────────────────────────────────────────────────────────────────
let gameState = {
  players:{}, bullets:[], loot:[],
  walls: generateMap(),
  zone: { x:MAP_W/2, y:MAP_H/2, r:Math.min(MAP_W,MAP_H)*0.65 },
  phase:'lobby', shrinkTimer:ZONE_SHRINK_INTERVAL,
  killFeed:[], gameTimer:0, winner:null, scores:{},
};
let bulletIdCounter = 0, shrinkPhase = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rectCircleCollide(rx,ry,rw,rh,cx,cy,cr) {
  const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
  return (cx-nx)**2+(cy-ny)**2 < cr*cr;
}
function dist2(x1,y1,x2,y2) { return (x1-x2)**2+(y1-y2)**2; }
function addKillFeed(msg) {
  gameState.killFeed.unshift({ msg, time:Date.now() });
  if (gameState.killFeed.length > 8) gameState.killFeed.pop();
}
function applyDamage(player, amount, killerId) {
  if (player.shield > 0) {
    const abs = Math.min(player.shield, amount);
    player.shield -= abs; amount -= abs;
  }
  player.hp -= amount;
  if (player.hp <= 0) {
    player.hp = 0; player.alive = false; player.deathTime = Date.now();
    if (killerId === 'zone') {
      addKillFeed(`☠️ ${player.name} was consumed by the zone`);
    } else {
      const k = gameState.players[killerId];
      if (k) {
        k.kills++;
        k.score += 100 + k.kills * 10;
        addKillFeed(`💀 ${k.name} eliminated ${player.name} [x${k.kills}]`);
      }
    }
    checkWin();
  }
}
function checkWin() {
  const alive = Object.values(gameState.players).filter(p=>p.alive);
  if (alive.length <= 1 && Object.keys(gameState.players).length > 1) {
    if (alive.length === 1) {
      alive[0].score += 500;
      gameState.winner = alive[0].name;
      addKillFeed(`👑 ${gameState.winner} WINS THE ZONE!`);
    }
    gameState.phase = 'ended';
    gameState.scores = {};
    for (const [id,p] of Object.entries(gameState.players)) {
      gameState.scores[id] = { name:p.name, score:p.score, kills:p.kills, color:p.color };
    }
    setTimeout(() => {
      if (Object.keys(gameState.players).length > 0) {
        resetGame(); io.emit('gameReset', getSafeState());
      }
    }, 10000);
  }
}

function resetGame() {
  const spawns = [
    {x:300,y:300},{x:MAP_W-300,y:300},{x:300,y:MAP_H-300},{x:MAP_W-300,y:MAP_H-300},
    {x:MAP_W/2,y:300},{x:MAP_W/2,y:MAP_H-300},{x:300,y:MAP_H/2},{x:MAP_W-300,y:MAP_H/2},
    {x:800,y:800},{x:MAP_W-800,y:800},{x:800,y:MAP_H-800},{x:MAP_W-800,y:MAP_H-800},
  ];
  gameState.bullets=[]; gameState.loot=spawnLoot(); gameState.walls=generateMap();
  gameState.zone={x:MAP_W/2,y:MAP_H/2,r:Math.min(MAP_W,MAP_H)*0.65};
  gameState.phase='playing'; gameState.shrinkTimer=ZONE_SHRINK_INTERVAL;
  gameState.killFeed=[]; gameState.gameTimer=0; gameState.winner=null; gameState.scores={};
  shrinkPhase=0;
  let si=0;
  for (const [,p] of Object.entries(gameState.players)) {
    const sp=spawns[si++%spawns.length];
    Object.assign(p,{
      x:sp.x+(Math.random()-.5)*200, y:sp.y+(Math.random()-.5)*200,
      hp:MAX_HP, shield:0, alive:true, kills:0, score:0,
      vx:0, vy:0, weapon:'pistol', ammo:{pistol:30}, lastFire:0,
    });
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
setInterval(() => {
  if (gameState.phase !== 'playing') return;
  gameState.gameTimer += TICK_MS;

  // Zone
  gameState.shrinkTimer -= TICK_MS;
  if (gameState.shrinkTimer <= 0) {
    shrinkPhase++;
    const newR = Math.max(120, gameState.zone.r - ZONE_SHRINK_AMOUNT - shrinkPhase*15);
    const ang = Math.random()*Math.PI*2, d = Math.random()*80;
    gameState.zone = {
      x: Math.max(newR, Math.min(MAP_W-newR, gameState.zone.x+Math.cos(ang)*d)),
      y: Math.max(newR, Math.min(MAP_H-newR, gameState.zone.y+Math.sin(ang)*d)),
      r: newR,
    };
    gameState.shrinkTimer = ZONE_SHRINK_INTERVAL;
    addKillFeed(`⚠️ Zone shrinking — Phase ${shrinkPhase}!`);
  }

  // Bullets
  const splashQ = [];
  gameState.bullets = gameState.bullets.filter(b => {
    b.x+=b.vx; b.y+=b.vy; b.life--;
    if (b.life<=0||b.x<0||b.x>MAP_W||b.y<0||b.y>MAP_H) { if(b.splash) splashQ.push(b); return false; }
    for (const w of gameState.walls) {
      if (b.x>=w.x&&b.x<=w.x+w.w&&b.y>=w.y&&b.y<=w.y+w.h) { if(b.splash) splashQ.push(b); return false; }
    }
    for (const [pid,p] of Object.entries(gameState.players)) {
      if (!p.alive||pid===b.owner) continue;
      if (dist2(b.x,b.y,p.x,p.y) < (BULLET_RADIUS+PLAYER_RADIUS)**2) {
        applyDamage(p, b.damage, b.owner);
        if(b.splash) splashQ.push(b);
        return false;
      }
    }
    return true;
  });
  for (const b of splashQ) {
    for (const [,p] of Object.entries(gameState.players)) {
      if (!p.alive) continue;
      const d = Math.sqrt(dist2(b.x,b.y,p.x,p.y));
      if (d < b.splash) applyDamage(p, b.damage*(1-d/b.splash)*0.6, b.owner);
    }
  }

  // Players
  for (const [id,p] of Object.entries(gameState.players)) {
    if (!p.alive) continue;
    let nx=p.x+p.vx, ny=p.y+p.vy;
    for (const w of gameState.walls) {
      if (rectCircleCollide(w.x,w.y,w.w,w.h,nx,ny,PLAYER_RADIUS)) {
        const cx=!rectCircleCollide(w.x,w.y,w.w,w.h,nx,p.y,PLAYER_RADIUS);
        const cy=!rectCircleCollide(w.x,w.y,w.w,w.h,p.x,ny,PLAYER_RADIUS);
        if(cx) ny=p.y; else if(cy) nx=p.x; else {nx=p.x;ny=p.y;}
      }
    }
    p.x=Math.max(PLAYER_RADIUS+TILE,Math.min(MAP_W-PLAYER_RADIUS-TILE,nx));
    p.y=Math.max(PLAYER_RADIUS+TILE,Math.min(MAP_H-PLAYER_RADIUS-TILE,ny));

    // Zone damage
    if (Math.sqrt((p.x-gameState.zone.x)**2+(p.y-gameState.zone.y)**2) > gameState.zone.r) {
      applyDamage(p, ZONE_DAMAGE/TICK_RATE, 'zone');
    }

    // Loot pickup
    gameState.loot = gameState.loot.filter(item => {
      if (dist2(p.x,p.y,item.x,item.y) > LOOT_PICKUP_RADIUS**2) return true;
      if (item.type==='weapon') {
        const w=WEAPONS[item.weapon];
        p.weapon=item.weapon;
        p.ammo[item.weapon]=(p.ammo[item.weapon]||0)+w.ammo;
        p.score+=5;
        io.to(id).emit('pickup',{msg:`Picked up ${w.emoji} ${w.name}!`, rarity:w.rarity, color:w.color});
      } else if (item.type==='heal') {
        const gained=Math.min(MAX_HP,p.hp+item.amount)-p.hp;
        p.hp+=gained; p.score+=2;
        io.to(id).emit('pickup',{msg:`${item.emoji} +${Math.round(gained)} HP`, rarity:item.rarity, color:item.color});
      } else if (item.type==='shield') {
        const gained=Math.min(MAX_SHIELD,p.shield+item.amount)-p.shield;
        p.shield+=gained; p.score+=3;
        io.to(id).emit('pickup',{msg:`🛡️ +${Math.round(gained)} Shield`, rarity:item.rarity, color:item.color});
      } else if (item.type==='ammo') {
        p.ammo[p.weapon]=(p.ammo[p.weapon]||0)+item.amount;
        io.to(id).emit('pickup',{msg:`📦 +${item.amount} Ammo`, rarity:item.rarity, color:item.color});
      }
      return false;
    });
  }

  io.emit('tick', getSafeState());
}, TICK_MS);

function getSafeState() {
  const players={};
  for (const [id,p] of Object.entries(gameState.players)) {
    const w=WEAPONS[p.weapon]||WEAPONS.pistol;
    players[id]={
      x:Math.round(p.x), y:Math.round(p.y),
      hp:Math.round(p.hp), shield:Math.round(p.shield||0),
      alive:p.alive, name:p.name, color:p.color,
      angle:p.angle, kills:p.kills, score:p.score,
      weapon:p.weapon, weaponName:w.name, weaponEmoji:w.emoji,
      weaponColor:w.color, weaponRarity:w.rarity,
      ammo:p.ammo[p.weapon]||0, deathTime:p.deathTime||null,
    };
  }
  return {
    players,
    bullets: gameState.bullets.map(b=>({x:Math.round(b.x),y:Math.round(b.y),id:b.id,color:b.color||'#ffcc00',size:b.size||5})),
    loot: gameState.loot.map(l=>({
      id:l.id, key:l.key, type:l.type,
      x:Math.round(l.x), y:Math.round(l.y),
      color:l.color, rarity:l.rarity,
      weapon:l.weapon, emoji:l.emoji,
      weaponEmoji: l.weapon?WEAPONS[l.weapon]?.emoji:null,
    })),
    zone:gameState.zone, phase:gameState.phase,
    killFeed:gameState.killFeed, gameTimer:Math.round(gameState.gameTimer),
    winner:gameState.winner, scores:gameState.scores||{},
  };
}

// ─── Sockets ──────────────────────────────────────────────────────────────────
const PLAYER_COLORS=['#FF6B6B','#FFE66D','#4ECDC4','#45B7D1','#96CEB4','#FF9FF3','#54A0FF','#5F27CD','#FF9F43','#00D2D3'];

io.on('connection', socket => {
  socket.on('join', ({name}) => {
    const color=PLAYER_COLORS[Object.keys(gameState.players).length%PLAYER_COLORS.length];
    const sx=300+Math.random()*(MAP_W-600), sy=300+Math.random()*(MAP_H-600);
    gameState.players[socket.id]={
      x:sx, y:sy, vx:0, vy:0,
      hp:MAX_HP, shield:0, alive:true,
      name:(name||'Player').slice(0,16), color,
      angle:0, kills:0, score:0,
      weapon:'pistol', ammo:{pistol:30}, lastFire:0,
    };
    if (gameState.phase==='lobby') { gameState.phase='playing'; gameState.loot=spawnLoot(); }
    socket.emit('init',{id:socket.id,walls:gameState.walls,mapW:MAP_W,mapH:MAP_H,...getSafeState()});
    addKillFeed(`🟢 ${name} dropped in`);
  });

  socket.on('input', input => {
    const p=gameState.players[socket.id];
    if (!p||!p.alive) return;
    let vx=0,vy=0;
    if(input.left) vx-=4; if(input.right) vx+=4;
    if(input.up) vy-=4; if(input.down) vy+=4;
    if(vx&&vy){vx*=0.707;vy*=0.707;}
    p.vx=vx; p.vy=vy; p.angle=input.angle||0;

    if (input.shoot) {
      const now=Date.now();
      const w=WEAPONS[p.weapon]||WEAPONS.pistol;
      if (now-p.lastFire>w.fireRate && (p.ammo[p.weapon]||0)>0) {
        p.lastFire=now; p.ammo[p.weapon]--;
        for (let i=0;i<w.bullets;i++) {
          const sp=(Math.random()-.5)*w.spread;
          const ang=(input.angle||0)+sp;
          gameState.bullets.push({
            id:bulletIdCounter++,
            x:p.x+Math.cos(ang)*(PLAYER_RADIUS+8),
            y:p.y+Math.sin(ang)*(PLAYER_RADIUS+8),
            vx:Math.cos(ang)*w.bulletSpeed, vy:Math.sin(ang)*w.bulletSpeed,
            owner:socket.id, damage:w.damage, life:w.bulletLife,
            color:w.color, size:w.name==='Sniper'?7:w.name==='Rocket'?9:5,
            splash:w.splash||0,
          });
        }
      }
    }
  });

  socket.on('startGame', () => { resetGame(); io.emit('gameReset',getSafeState()); });

  socket.on('disconnect', () => {
    const p=gameState.players[socket.id];
    if(p) addKillFeed(`🔴 ${p.name} left`);
    delete gameState.players[socket.id];
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🎮 ZONE server on port ${PORT}`));
