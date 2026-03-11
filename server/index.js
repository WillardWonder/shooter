const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, '../public')));

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_W = 2400, MAP_H = 1800, TILE = 40;
const PLAYER_RADIUS = 16, BULLET_RADIUS = 5;
const MAX_HP = 100, MAX_SHIELD = 50;
const ZONE_SHRINK_INTERVAL = 20000, ZONE_SHRINK_AMOUNT = 100, ZONE_DAMAGE = 15;
const TICK_RATE = 60, TICK_MS = 1000 / TICK_RATE;
const LOOT_PICKUP_RADIUS = 32, LOOT_SPAWN_COUNT = 50;
const GHOST_ITEMS_NEEDED = 5;       // items to collect as ghost to revive
const GRENADE_FUSE = 2500;          // ms before explode
const GRENADE_RADIUS = 100;         // splash radius
const GRENADE_DAMAGE = 80;
const GRENADE_COOLDOWN = 5000;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const LEADERBOARD_SIZE = 10;

// ─── Persistent Leaderboard ───────────────────────────────────────────────────
function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) { console.error('Leaderboard load error:', e.message); }
  return [];
}
function saveLeaderboard(lb) {
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(lb, null, 2)); }
  catch (e) { console.error('Leaderboard save error:', e.message); }
}
function updateLeaderboard(name, score, kills) {
  const lb = loadLeaderboard();
  lb.push({ name, score, kills, date: new Date().toISOString().slice(0, 10) });
  lb.sort((a, b) => b.score - a.score);
  const trimmed = lb.slice(0, LEADERBOARD_SIZE);
  saveLeaderboard(trimmed);
  return trimmed;
}

// ─── Weapons ──────────────────────────────────────────────────────────────────
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
  { key:'medkit',  type:'heal',   amount:50, rarity:'uncommon', color:'#ff4466', emoji:'❤️',  weight:15 },
  { key:'bandage', type:'heal',   amount:20, rarity:'common',   color:'#ff8899', emoji:'🩹',  weight:25 },
  { key:'shield',  type:'shield', amount:50, rarity:'rare',     color:'#4488ff', emoji:'🛡️', weight:12 },
  { key:'ammo',    type:'ammo',   amount:30, rarity:'common',   color:'#ffcc44', emoji:'📦',  weight:30 },
  { key:'grenade', type:'grenade',count:2,   rarity:'uncommon', color:'#88ff44', emoji:'💣',  weight:14 },
];
function randomLoot() {
  const total = LOOT_TABLE.reduce((s,l) => s+l.weight, 0);
  let r = Math.random() * total;
  for (const l of LOOT_TABLE) { r -= l.weight; if (r <= 0) return { ...l }; }
  return { ...LOOT_TABLE[0] };
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function generateMap() {
  return [
    {x:0,y:0,w:MAP_W,h:TILE},{x:0,y:MAP_H-TILE,w:MAP_W,h:TILE},
    {x:0,y:0,w:TILE,h:MAP_H},{x:MAP_W-TILE,y:0,w:TILE,h:MAP_H},
    {x:200,y:200,w:180,h:120},{x:500,y:400,w:200,h:140},{x:900,y:150,w:160,h:160},
    {x:1300,y:300,w:220,h:100},{x:1700,y:200,w:180,h:180},{x:2000,y:350,w:150,h:150},
    {x:300,y:800,w:200,h:120},{x:700,y:700,w:160,h:200},{x:1100,y:800,w:240,h:140},
    {x:1500,y:700,w:180,h:160},{x:1900,y:800,w:200,h:120},{x:200,y:1300,w:180,h:160},
    {x:600,y:1200,w:200,h:180},{x:1000,y:1300,w:160,h:140},{x:1400,y:1200,w:220,h:160},
    {x:1800,y:1300,w:180,h:140},{x:2100,y:1100,w:160,h:160},
    {x:450,y:600,w:60,h:60},{x:860,y:500,w:80,h:60},{x:1200,y:600,w:60,h:80},
    {x:1600,y:500,w:80,h:60},{x:750,y:1000,w:60,h:60},{x:1350,y:1000,w:60,h:60},
    {x:1700,y:1000,w:80,h:60},{x:400,y:1100,w:60,h:80},
  ];
}
function isSpawnClear(x, y, walls) {
  for (const w of walls) {
    // Keep players at least PLAYER_RADIUS+4 away from any wall rect
    const nr = PLAYER_RADIUS + 8;
    if (x+nr > w.x && x-nr < w.x+w.w && y+nr > w.y && y-nr < w.y+w.h) return false;
  }
  return true;
}

function findSafeSpawn(walls) {
  // Try fixed spawn points first, then random
  const candidates = [
    {x:300,y:300},{x:MAP_W-300,y:300},{x:300,y:MAP_H-300},{x:MAP_W-300,y:MAP_H-300},
    {x:MAP_W/2,y:300},{x:MAP_W/2,y:MAP_H-300},{x:300,y:MAP_H/2},{x:MAP_W-300,y:MAP_H/2},
    {x:800,y:500},{x:MAP_W-800,y:500},{x:800,y:MAP_H-500},{x:MAP_W-800,y:MAP_H-500},
    {x:1200,y:900},{x:MAP_W/2,y:MAP_H/2-300},{x:MAP_W/2,y:MAP_H/2+300},
  ];
  for (const c of candidates) {
    if (isSpawnClear(c.x, c.y, walls)) return { x: c.x, y: c.y };
  }
  // Fallback: random search
  for (let i = 0; i < 200; i++) {
    const x = TILE*3 + Math.random()*(MAP_W-TILE*6);
    const y = TILE*3 + Math.random()*(MAP_H-TILE*6);
    if (isSpawnClear(x, y, walls)) return { x, y };
  }
  return { x: MAP_W/2, y: MAP_H/2 }; // last resort
}

function spawnLoot() {
  const items = [];
  for (let i = 0; i < LOOT_SPAWN_COUNT; i++) {
    const def = randomLoot();
    items.push({ ...def, id:`loot_${i}_${Date.now()}`,
      x: TILE*2 + Math.random()*(MAP_W-TILE*4),
      y: TILE*2 + Math.random()*(MAP_H-TILE*4) });
  }
  return items;
}

// ─── State ────────────────────────────────────────────────────────────────────
let gameState = {
  players:{}, bullets:[], grenades:[], loot:[],
  walls: generateMap(),
  zone:{x:MAP_W/2,y:MAP_H/2,r:Math.min(MAP_W,MAP_H)*0.65},
  phase:'lobby', shrinkTimer:ZONE_SHRINK_INTERVAL,
  killFeed:[], gameTimer:0, winner:null, scores:{},
};
let bulletIdCounter=0, grenadeIdCounter=0, shrinkPhase=0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rectCircleCollide(rx,ry,rw,rh,cx,cy,cr) {
  const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
  return (cx-nx)**2+(cy-ny)**2 < cr*cr;
}
function dist2(x1,y1,x2,y2){return (x1-x2)**2+(y1-y2)**2;}
function addKillFeed(msg){
  gameState.killFeed.unshift({msg,time:Date.now()});
  if(gameState.killFeed.length>8) gameState.killFeed.pop();
}

function applyDamage(player, amount, killerId) {
  // Ghosts are immune to damage
  if (player.ghost) return;
  if (player.shield > 0) {
    const abs = Math.min(player.shield, amount);
    player.shield -= abs; amount -= abs;
  }
  player.hp -= amount;
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    player.deathTime = Date.now();
    // Enter ghost mode instead of full elimination
    player.ghost = true;
    player.ghostItems = 0;
    player.ghostHp = 3; // ghost can be "hit" 3 more times before true death
    if (killerId === 'zone') {
      addKillFeed(`☠️ ${player.name} is a ghost (zone)`);
    } else {
      const k = gameState.players[killerId];
      if (k) {
        k.kills++; k.score += 100 + k.kills*10;
        addKillFeed(`💀 ${k.name} ghosted ${player.name} [x${k.kills}]`);
      }
    }
    checkWin();
  }
}

function ghostEliminate(player, killerId) {
  player.ghost = false;
  player.alive = false;
  player.eliminated = true;
  const k = killerId && killerId !== 'zone' ? gameState.players[killerId] : null;
  if (k) { k.kills++; k.score += 50; }
  addKillFeed(`💀 ${player.name} eliminated${k ? ` by ${k.name}` : ' by zone'}`);
  checkWin();
}

function checkWin() {
  // Only truly alive (not ghost, not eliminated) players count
  const realAlive = Object.values(gameState.players).filter(p => p.alive && !p.ghost && !p.eliminated);
  const total = Object.keys(gameState.players).length;

  if (realAlive.length <= 1 && total > 1) {
    // Eliminate any remaining ghosts — game is over
    for (const p of Object.values(gameState.players)) {
      if (p.ghost) { p.ghost = false; p.alive = false; p.eliminated = true; }
    }
    if (realAlive.length === 1) {
      realAlive[0].score += 500;
      gameState.winner = realAlive[0].name;
      addKillFeed(`👑 ${gameState.winner} WINS THE ZONE!`);
      const lb = updateLeaderboard(realAlive[0].name, realAlive[0].score, realAlive[0].kills);
      gameState.leaderboard = lb;
    }
    gameState.phase = 'ended';
    gameState.scores = {};
    for (const [id,p] of Object.entries(gameState.players)) {
      gameState.scores[id] = {name:p.name,score:p.score,kills:p.kills,color:p.color};
    }
    setTimeout(() => {
      if (Object.keys(gameState.players).length > 0) {
        resetGame(); io.emit('gameReset', getSafeState());
      }
    }, 10000);
  }
}

function resetGame() {
  gameState.bullets=[]; gameState.grenades=[]; gameState.loot=spawnLoot();
  gameState.walls=generateMap();
  gameState.zone={x:MAP_W/2,y:MAP_H/2,r:Math.min(MAP_W,MAP_H)*0.65};
  gameState.phase='playing'; gameState.shrinkTimer=ZONE_SHRINK_INTERVAL;
  gameState.killFeed=[]; gameState.gameTimer=0; gameState.winner=null; gameState.scores={};
  shrinkPhase=0;
  for (const [,p] of Object.entries(gameState.players)) {
    const sp = findSafeSpawn(gameState.walls);
    Object.assign(p,{
      x:sp.x, y:sp.y,
      hp:MAX_HP, shield:0, alive:true, ghost:false, ghostItems:0, ghostHp:3,
      eliminated:false, kills:0, score:0, vx:0, vy:0,
      weapon:'pistol', ammo:{pistol:30}, grenades:2, lastFire:0, lastGrenade:0,
    });
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
setInterval(() => {
  if (gameState.phase !== 'playing') return;
  gameState.gameTimer += TICK_MS;

  // Zone shrink
  gameState.shrinkTimer -= TICK_MS;
  if (gameState.shrinkTimer <= 0) {
    shrinkPhase++;
    const newR=Math.max(120, gameState.zone.r-ZONE_SHRINK_AMOUNT-shrinkPhase*15);
    const ang=Math.random()*Math.PI*2, d=Math.random()*80;
    gameState.zone={
      x:Math.max(newR,Math.min(MAP_W-newR,gameState.zone.x+Math.cos(ang)*d)),
      y:Math.max(newR,Math.min(MAP_H-newR,gameState.zone.y+Math.sin(ang)*d)),
      r:newR,
    };
    gameState.shrinkTimer=ZONE_SHRINK_INTERVAL;
    addKillFeed(`⚠️ Zone shrinking — Phase ${shrinkPhase}!`);
  }

  // Grenades
  const now = Date.now();
  gameState.grenades = gameState.grenades.filter(g => {
    // Move grenade (arc)
    g.x += g.vx; g.y += g.vy;
    g.vx *= 0.96; g.vy *= 0.96;
    // Wall bounce
    for (const w of gameState.walls) {
      if (g.x>=w.x&&g.x<=w.x+w.w&&g.y>=w.y&&g.y<=w.y+w.h) {
        g.vx *= -0.5; g.vy *= -0.5;
        g.x += g.vx*3; g.y += g.vy*3;
      }
    }
    // Explode when fuse runs out
    if (now >= g.explodeAt) {
      // Splash to all players
      for (const [,p] of Object.entries(gameState.players)) {
        const d = Math.sqrt(dist2(g.x,g.y,p.x,p.y));
        if (d < GRENADE_RADIUS) {
          const dmg = GRENADE_DAMAGE * (1 - d/GRENADE_RADIUS);
          if (p.alive && !p.ghost) applyDamage(p, dmg, g.owner);
          else if (p.ghost) {
            p.ghostHp--;
            if (p.ghostHp <= 0) ghostEliminate(p, g.owner);
          }
        }
      }
      io.emit('grenadeExplode', {x:Math.round(g.x), y:Math.round(g.y), r:GRENADE_RADIUS});
      return false;
    }
    return true;
  });

  // Bullets
  const splashQ=[];
  gameState.bullets = gameState.bullets.filter(b => {
    b.x+=b.vx; b.y+=b.vy; b.life--;
    if (b.life<=0||b.x<0||b.x>MAP_W||b.y<0||b.y>MAP_H) {if(b.splash)splashQ.push({...b});return false;}
    for (const w of gameState.walls) {
      if (b.x>=w.x&&b.x<=w.x+w.w&&b.y>=w.y&&b.y<=w.y+w.h) {if(b.splash)splashQ.push({...b});return false;}
    }
    for (const [pid,p] of Object.entries(gameState.players)) {
      if (pid===b.owner) continue;
      if (!p.alive && !p.ghost) continue;
      if (dist2(b.x,b.y,p.x,p.y) < (BULLET_RADIUS+PLAYER_RADIUS)**2) {
        if (p.ghost) {
          // Bullets slow down ghost revival
          p.ghostHp--;
          if (p.ghostHp<=0) ghostEliminate(p, b.owner);
        } else {
          applyDamage(p, b.damage, b.owner);
        }
        if(b.splash)splashQ.push({...b});
        return false;
      }
    }
    return true;
  });
  for (const b of splashQ) {
    for (const [,p] of Object.entries(gameState.players)) {
      if (!p.alive||p.ghost) continue;
      const d=Math.sqrt(dist2(b.x,b.y,p.x,p.y));
      if (d<b.splash) applyDamage(p, b.damage*(1-d/b.splash)*0.6, b.owner);
    }
  }

  // Players & ghosts
  for (const [id,p] of Object.entries(gameState.players)) {
    const moving = p.alive || p.ghost;
    if (!moving || p.eliminated) continue;

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

    // Zone damage (living players only)
    if (p.alive && !p.ghost) {
      if (Math.sqrt((p.x-gameState.zone.x)**2+(p.y-gameState.zone.y)**2) > gameState.zone.r) {
        applyDamage(p, ZONE_DAMAGE/TICK_RATE, 'zone');
      }
    }

    // Loot pickup
    gameState.loot = gameState.loot.filter(item => {
      if (dist2(p.x,p.y,item.x,item.y) > LOOT_PICKUP_RADIUS**2) return true;

      if (p.ghost) {
        // Ghost collects items for revival — any item counts
        p.ghostItems++;
        p.score += 1;
        io.to(id).emit('pickup',{
          msg:`👻 ${p.ghostItems}/${GHOST_ITEMS_NEEDED} — ${GHOST_ITEMS_NEEDED-p.ghostItems} more to revive!`,
          color:'#aaffee', rarity:'uncommon'
        });
        if (p.ghostItems >= GHOST_ITEMS_NEEDED) {
          // REVIVE!
          p.ghost = false;
          p.alive = true;
          p.hp = 30;
          p.shield = 0;
          p.weapon = 'pistol';
          p.ammo = { pistol: 15 };
          p.grenades = 1;
          p.score += 50;
          addKillFeed(`👻 ${p.name} came back from the dead!`);
          io.to(id).emit('pickup',{msg:'👻 REVIVED! Back in the fight!', color:'#00ffaa', rarity:'epic'});
        }
        return false;
      }

      // Normal pickup
      if (item.type==='weapon') {
        const w=WEAPONS[item.weapon];
        p.weapon=item.weapon; p.ammo[item.weapon]=(p.ammo[item.weapon]||0)+w.ammo; p.score+=5;
        io.to(id).emit('pickup',{msg:`Picked up ${w.emoji} ${w.name}!`,rarity:w.rarity,color:w.color});
      } else if (item.type==='heal') {
        const gained=Math.min(MAX_HP,p.hp+item.amount)-p.hp;
        p.hp+=gained; p.score+=2;
        io.to(id).emit('pickup',{msg:`${item.emoji} +${Math.round(gained)} HP`,rarity:item.rarity,color:item.color});
      } else if (item.type==='shield') {
        const gained=Math.min(MAX_SHIELD,p.shield+item.amount)-p.shield;
        p.shield+=gained; p.score+=3;
        io.to(id).emit('pickup',{msg:`🛡️ +${Math.round(gained)} Shield`,rarity:item.rarity,color:item.color});
      } else if (item.type==='ammo') {
        p.ammo[p.weapon]=(p.ammo[p.weapon]||0)+item.amount;
        io.to(id).emit('pickup',{msg:`📦 +${item.amount} Ammo`,rarity:item.rarity,color:item.color});
      } else if (item.type==='grenade') {
        p.grenades=(p.grenades||0)+item.count;
        io.to(id).emit('pickup',{msg:`💣 +${item.count} Grenades`,rarity:item.rarity,color:item.color});
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
      alive:p.alive, ghost:p.ghost||false,
      ghostItems:p.ghostItems||0, ghostHp:p.ghostHp||0,
      eliminated:p.eliminated||false,
      name:p.name, color:p.color, angle:p.angle,
      kills:p.kills, score:p.score,
      weapon:p.weapon, weaponName:w.name, weaponEmoji:w.emoji,
      weaponColor:w.color, weaponRarity:w.rarity,
      ammo:p.ammo[p.weapon]||0, grenades:p.grenades||0,
      deathTime:p.deathTime||null,
    };
  }
  return {
    players,
    bullets:gameState.bullets.map(b=>({x:Math.round(b.x),y:Math.round(b.y),id:b.id,color:b.color||'#ffcc00',size:b.size||5})),
    grenades:gameState.grenades.map(g=>({id:g.id,x:Math.round(g.x),y:Math.round(g.y),explodeAt:g.explodeAt,owner:g.owner})),
    loot:gameState.loot.map(l=>({
      id:l.id,key:l.key,type:l.type,x:Math.round(l.x),y:Math.round(l.y),
      color:l.color,rarity:l.rarity,weapon:l.weapon,emoji:l.emoji,
      weaponEmoji:l.weapon?WEAPONS[l.weapon]?.emoji:null,
    })),
    zone:gameState.zone,phase:gameState.phase,
    killFeed:gameState.killFeed,gameTimer:Math.round(gameState.gameTimer),
    winner:gameState.winner,scores:gameState.scores||{},
    leaderboard:gameState.leaderboard||loadLeaderboard(),
  };
}

// ─── Sockets ──────────────────────────────────────────────────────────────────
const PLAYER_COLORS=['#FF6B6B','#FFE66D','#4ECDC4','#45B7D1','#96CEB4','#FF9FF3','#54A0FF','#5F27CD','#FF9F43','#00D2D3'];

io.on('connection', socket => {
  socket.on('join', ({name}) => {
    const color=PLAYER_COLORS[Object.keys(gameState.players).length%PLAYER_COLORS.length];
    const {x:sx, y:sy} = findSafeSpawn(gameState.walls);
    gameState.players[socket.id]={
      x:sx,y:sy,vx:0,vy:0,
      hp:MAX_HP,shield:0,alive:true,
      ghost:false,ghostItems:0,ghostHp:3,eliminated:false,
      name:(name||'Player').slice(0,16),color,
      angle:0,kills:0,score:0,
      weapon:'pistol',ammo:{pistol:30},grenades:2,lastFire:0,lastGrenade:0,
    };
    if (gameState.phase==='lobby'){gameState.phase='playing';gameState.loot=spawnLoot();}
    socket.emit('init',{id:socket.id,walls:gameState.walls,mapW:MAP_W,mapH:MAP_H,...getSafeState()});
    addKillFeed(`🟢 ${name} dropped in`);
  });

  socket.on('input', input => {
    const p=gameState.players[socket.id];
    if (!p||(p.eliminated&&!p.ghost)) return;
    if (!p.alive && !p.ghost) return;

    let vx=0,vy=0;
    if(input.left) vx-=4; if(input.right) vx+=4;
    if(input.up) vy-=4; if(input.down) vy+=4;
    if(vx&&vy){vx*=0.707;vy*=0.707;}
    // Ghosts move slower
    if(p.ghost){vx*=0.65;vy*=0.65;}
    p.vx=vx; p.vy=vy; p.angle=input.angle||0;

    if (p.alive && !p.ghost) {
      // Shoot
      if (input.shoot) {
        const now=Date.now();
        const w=WEAPONS[p.weapon]||WEAPONS.pistol;
        if (now-p.lastFire>w.fireRate&&(p.ammo[p.weapon]||0)>0) {
          p.lastFire=now; p.ammo[p.weapon]--;
          for (let i=0;i<w.bullets;i++) {
            const sp=(Math.random()-.5)*w.spread;
            const ang=(input.angle||0)+sp;
            gameState.bullets.push({
              id:bulletIdCounter++,
              x:p.x+Math.cos(ang)*(PLAYER_RADIUS+8),
              y:p.y+Math.sin(ang)*(PLAYER_RADIUS+8),
              vx:Math.cos(ang)*w.bulletSpeed, vy:Math.sin(ang)*w.bulletSpeed,
              owner:socket.id,damage:w.damage,life:w.bulletLife,
              color:w.color,size:w.name==='Sniper'?7:w.name==='Rocket'?9:5,
              splash:w.splash||0,
            });
          }
        }
      }
      // Throw grenade
      if (input.grenade) {
        const now=Date.now();
        if ((p.grenades||0)>0 && now-p.lastGrenade>GRENADE_COOLDOWN) {
          p.lastGrenade=now; p.grenades--;
          const ang=input.angle||0;
          const spd=10;
          gameState.grenades.push({
            id:grenadeIdCounter++,
            x:p.x+Math.cos(ang)*20, y:p.y+Math.sin(ang)*20,
            vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
            owner:socket.id, explodeAt:Date.now()+GRENADE_FUSE,
          });
        }
      }
    }
  });

  socket.on('requestLeaderboard', () => {
    socket.emit('leaderboard', loadLeaderboard());
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
