// ─── ZONE — Retro Battle Royale Client ───────────────────────────────────────
const socket = io();
window._socket = socket;

const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mmCtx   = minimap.getContext('2d');

let myId=null, gameData=null, walls=[], MAP_W=2400, MAP_H=1800;
let cameraX=0, cameraY=0;
let mouseX=0, mouseY=0, worldMouseX=0, worldMouseY=0;
let shooting=false, throwingGrenade=false, joined=false;

const particles=[], pickupNotifs=[], explosions=[];

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── Keyboard Input ───────────────────────────────────────────────────────────
const keys={left:false,right:false,up:false,down:false,grenade:false};
function isTyping(){const t=document.activeElement?.tagName;return t==='INPUT'||t==='TEXTAREA';}

window.addEventListener('keydown',e=>{
  if(isTyping()) return;
  switch(e.code){
    case'ArrowLeft':case'KeyA':keys.left=true;e.preventDefault();break;
    case'ArrowRight':case'KeyD':keys.right=true;e.preventDefault();break;
    case'ArrowUp':case'KeyW':keys.up=true;e.preventDefault();break;
    case'ArrowDown':case'KeyS':keys.down=true;e.preventDefault();break;
    case'KeyG':throwingGrenade=true;e.preventDefault();break;
  }
});
window.addEventListener('keyup',e=>{
  switch(e.code){
    case'ArrowLeft':case'KeyA':keys.left=false;break;
    case'ArrowRight':case'KeyD':keys.right=false;break;
    case'ArrowUp':case'KeyW':keys.up=false;break;
    case'ArrowDown':case'KeyS':keys.down=false;break;
    case'KeyG':throwingGrenade=false;break;
  }
});
window.addEventListener('mousemove',e=>{
  const r=canvas.getBoundingClientRect();
  mouseX=e.clientX-r.left; mouseY=e.clientY-r.top;
  worldMouseX=mouseX+cameraX; worldMouseY=mouseY+cameraY;
});
window.addEventListener('mousedown',e=>{if(e.button===0&&joined)shooting=true;});
window.addEventListener('mouseup',  e=>{if(e.button===0)shooting=false;});
window.addEventListener('contextmenu',e=>{if(joined)e.preventDefault();});

// ─── Mobile / Touch Controls ──────────────────────────────────────────────────
const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');
const fireBtn      = document.getElementById('fireBtn');
const grenadeBtn   = document.getElementById('grenadeBtn');

let joyActive=false, joyId=null, joyOriginX=0, joyOriginY=0;
const JOY_MAX=40;

joystickZone.addEventListener('touchstart',e=>{
  e.preventDefault();
  const t=e.changedTouches[0];
  joyActive=true; joyId=t.identifier;
  const r=joystickZone.getBoundingClientRect();
  joyOriginX=t.clientX-r.left; joyOriginY=t.clientY-r.top;
},{passive:false});

joystickZone.addEventListener('touchmove',e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier!==joyId) continue;
    const r=joystickZone.getBoundingClientRect();
    let dx=t.clientX-r.left-joyOriginX, dy=t.clientY-r.top-joyOriginY;
    const len=Math.sqrt(dx*dx+dy*dy);
    if(len>JOY_MAX){dx=dx/len*JOY_MAX;dy=dy/len*JOY_MAX;}
    joystickKnob.style.transform=`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dead=6;
    keys.left=dx<-dead; keys.right=dx>dead; keys.up=dy<-dead; keys.down=dy>dead;
  }
},{passive:false});

function resetJoy(){
  joyActive=false; joyId=null;
  joystickKnob.style.transform='translate(-50%,-50%)';
  keys.left=keys.right=keys.up=keys.down=false;
}
joystickZone.addEventListener('touchend',e=>{e.preventDefault();resetJoy();},{passive:false});
joystickZone.addEventListener('touchcancel',e=>{e.preventDefault();resetJoy();},{passive:false});

// Aim joystick on right side (second touch anywhere on canvas)
let aimTouchId=null;
canvas.addEventListener('touchstart',e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.clientX>window.innerWidth/2&&aimTouchId===null){
      aimTouchId=t.identifier;
      shooting=true;
      const r=canvas.getBoundingClientRect();
      mouseX=t.clientX-r.left; mouseY=t.clientY-r.top;
      worldMouseX=mouseX+cameraX; worldMouseY=mouseY+cameraY;
    }
  }
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier===aimTouchId){
      const r=canvas.getBoundingClientRect();
      mouseX=t.clientX-r.left; mouseY=t.clientY-r.top;
      worldMouseX=mouseX+cameraX; worldMouseY=mouseY+cameraY;
    }
  }
},{passive:false});
canvas.addEventListener('touchend',e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier===aimTouchId){aimTouchId=null;shooting=false;}
  }
},{passive:false});

fireBtn.addEventListener('touchstart',e=>{e.preventDefault();shooting=true;},{passive:false});
fireBtn.addEventListener('touchend',  e=>{e.preventDefault();shooting=false;},{passive:false});
grenadeBtn.addEventListener('touchstart',e=>{e.preventDefault();throwingGrenade=true;},{passive:false});
grenadeBtn.addEventListener('touchend',  e=>{e.preventDefault();throwingGrenade=false;},{passive:false});

// ─── Socket Events ────────────────────────────────────────────────────────────
socket.on('connect',()=>{document.getElementById('connecting').style.display='none';});

socket.on('init',data=>{
  myId=data.id; walls=data.walls; MAP_W=data.mapW; MAP_H=data.mapH;
  gameData=data; updateHUD(data);
});

socket.on('tick',data=>{
  const prev=gameData; gameData=data;
  if(prev?.bullets){
    const curIds=new Set(data.bullets.map(b=>b.id));
    for(const b of prev.bullets) if(!curIds.has(b.id)) spawnParticles(b.x,b.y,b.color||'#ffcc00',5);
  }
  if(prev?.players){
    for(const[id,p]of Object.entries(data.players)){
      const pp=prev.players[id];
      if(pp?.alive&&!pp?.ghost&&p.ghost) spawnParticles(p.x,p.y,p.color,20);
    }
  }
  updateHUD(data);
});

socket.on('gameReset',data=>{
  gameData=data;
  document.getElementById('overlay').classList.remove('show');
  updateHUD(data);
});

socket.on('pickup',({msg,rarity,color})=>{
  const me=gameData?.players?.[myId]; if(!me) return;
  pickupNotifs.push({msg,color:color||'#ffffff',t:1.0,x:me.x,y:me.y-30});
  updateHUD(gameData);
});

socket.on('grenadeExplode',({x,y,r})=>{
  explosions.push({x,y,r,life:1.0});
  spawnParticles(x,y,'#ff6600',30);
  spawnParticles(x,y,'#ffcc00',20);
  spawnParticles(x,y,'#ff3300',15);
});

// ─── Particles & FX ──────────────────────────────────────────────────────────
function spawnParticles(x,y,color,count){
  for(let i=0;i<count;i++){
    const ang=Math.random()*Math.PI*2, spd=2+Math.random()*7;
    particles.push({x,y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life:1,decay:0.03+Math.random()*0.04,color,size:2+Math.random()*5});
  }
}
function updateFX(){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=p.decay;
    if(p.life<=0) particles.splice(i,1);
  }
  for(let i=pickupNotifs.length-1;i>=0;i--){
    const n=pickupNotifs[i]; n.y-=0.5; n.t-=0.016;
    if(n.t<=0) pickupNotifs.splice(i,1);
  }
  for(let i=explosions.length-1;i>=0;i--){
    explosions[i].life-=0.04;
    if(explosions[i].life<=0) explosions.splice(i,1);
  }
}

// ─── HUD Update ───────────────────────────────────────────────────────────────
const RARITY_COLORS={common:'#aaaaaa',uncommon:'#44cc44',rare:'#4488ff',epic:'#aa44ff',legendary:'#ff8800'};
let lastKillFeed=[];

function updateHUD(data){
  if(!myId||!data?.players?.[myId]) return;
  const me=data.players[myId];

  // Ghost HUD
  const ghostHud=document.getElementById('ghostHud');
  if(me.ghost){
    ghostHud.classList.add('show');
    document.getElementById('ghostProg').textContent=`${me.ghostItems}/5 items collected`;
    document.getElementById('ghostBar').style.width=(me.ghostItems/5*100)+'%';
  } else {
    ghostHud.classList.remove('show');
  }

  if(!me.alive&&!me.ghost) return; // dead + not ghost = skip rest

  const hp=Math.max(0,me.hp);
  const hpBar=document.getElementById('hpBar');
  hpBar.style.width=hp+'%';
  hpBar.style.background=hp>50?'#44ffaa':hp>25?'#ffcc00':'#ff4444';
  document.getElementById('hpText').textContent=Math.round(hp);

  const sh=Math.max(0,me.shield||0);
  document.getElementById('shieldBar').style.width=(sh/50*100)+'%';
  document.getElementById('shieldText').textContent=Math.round(sh);
  document.getElementById('shieldRow').style.opacity=sh>0?'1':'0.3';

  const wColor=RARITY_COLORS[me.weaponRarity]||'#fff';
  document.getElementById('weaponInfo').innerHTML=
    `<span style="color:${wColor};font-size:20px">${me.weaponEmoji||'🔫'}</span>
     <span style="color:${wColor}">${me.weaponName||'Pistol'}</span>`;
  document.getElementById('ammoInfo').textContent=`${me.ammo||0} ammo`;
  document.getElementById('weaponBox').style.borderColor=wColor;
  document.getElementById('grenadeCount').textContent=`💣 ${me.grenades||0}`;

  document.getElementById('killCount').textContent=me.kills||0;
  document.getElementById('scoreCount').textContent=me.score||0;

  const alive=Object.values(data.players).filter(p=>p.alive&&!p.ghost).length;
  const total=Object.keys(data.players).length;
  document.getElementById('aliveCount').textContent=`${alive}/${total} alive`;

  if(JSON.stringify(data.killFeed)!==JSON.stringify(lastKillFeed)){
    lastKillFeed=[...(data.killFeed||[])];
    const kf=document.getElementById('killfeed');
    kf.innerHTML='';
    (data.killFeed||[]).forEach(item=>{
      const d=document.createElement('div');
      d.className='kf-item'; d.textContent=item.msg; kf.appendChild(d);
    });
  }

  const overlay=document.getElementById('overlay');
  if(data.phase==='ended'){
    overlay.classList.add('show'); showScoreboard(data);
  } else if(!me.alive&&!me.ghost){
    overlay.classList.add('show');
    document.getElementById('overlayTitle').textContent='YOU DIED';
    document.getElementById('overlayTitle').style.color='#ff4444';
    document.getElementById('overlaySub').textContent=`${me.kills||0} kills · ${me.score||0} pts`;
    document.getElementById('scoreboard').style.display='none';
  } else {
    overlay.classList.remove('show');
  }
}

function showScoreboard(data){
  const isWinner=data.winner===data.players[myId]?.name;
  document.getElementById('overlayTitle').textContent=isWinner?'👑 VICTORY ROYALE':'GAME OVER';
  document.getElementById('overlayTitle').style.color=isWinner?'#ffcc00':'#ff6666';
  document.getElementById('overlaySub').textContent=`${data.winner||'nobody'} wins!`;
  const sb=document.getElementById('scoreboard');
  sb.style.display='block';
  const scores=Object.values(data.scores||{}).sort((a,b)=>b.score-a.score);
  sb.innerHTML=`<div style="font-size:13px;color:#888;margin-bottom:8px;letter-spacing:2px;font-family:'Press Start 2P'">FINAL SCORES</div>`+
    scores.map((s,i)=>`<div style="display:flex;justify-content:space-between;padding:4px 8px;margin:2px 0;background:rgba(255,255,255,0.05);border-left:3px solid ${s.color}">
      <span style="color:${s.color}">${i===0?'👑 ':''}${s.name}</span>
      <span style="color:#ffcc00">${s.score}pts</span>
      <span style="color:#ff6666">${s.kills}💀</span>
    </div>`).join('');
  if(data.leaderboard?.length){
    sb.innerHTML+=`<div style="font-size:11px;color:#888;margin:14px 0 6px;letter-spacing:2px;font-family:'Press Start 2P'">ALL-TIME TOP SCORES</div>`+
      data.leaderboard.slice(0,5).map((e,i)=>`<div style="display:flex;justify-content:space-between;padding:3px 8px;font-size:14px;color:#aaa">
        <span>${['🥇','🥈','🥉'][i]||'#'+(i+1)} ${e.name}</span>
        <span style="color:#ffcc00">${e.score}pts</span>
      </div>`).join('');
  }
}

// ─── Input loop ───────────────────────────────────────────────────────────────
setInterval(()=>{
  if(!myId||!joined) return;
  const me=gameData?.players?.[myId];
  if(!me||(!me.alive&&!me.ghost)) return;
  socket.emit('input',{
    left:keys.left,right:keys.right,up:keys.up,down:keys.down,
    angle:Math.atan2(worldMouseY-me.y,worldMouseX-me.x),
    shoot:shooting,
    grenade:throwingGrenade,
  });
  if(throwingGrenade) throwingGrenade=false; // one-shot per press
},1000/60);

// ─── Drawing ──────────────────────────────────────────────────────────────────
const RARITY_GLOW={common:'rgba(170,170,170,0.4)',uncommon:'rgba(68,204,68,0.5)',rare:'rgba(68,136,255,0.6)',epic:'rgba(170,68,255,0.7)',legendary:'rgba(255,136,0,0.8)'};

function drawBg(){
  const T=80,sx=Math.floor(cameraX/T)*T,sy=Math.floor(cameraY/T)*T;
  for(let x=sx;x<cameraX+canvas.width+T;x+=T)
    for(let y=sy;y<cameraY+canvas.height+T;y+=T){
      ctx.fillStyle=((x/T+y/T)%2|0)?'#111124':'#0f0f1a';
      ctx.fillRect(x-cameraX,y-cameraY,T,T);
    }
  ctx.strokeStyle='rgba(42,42,58,0.4)';ctx.lineWidth=0.5;
  for(let x=sx;x<cameraX+canvas.width+T;x+=T){ctx.beginPath();ctx.moveTo(x-cameraX,0);ctx.lineTo(x-cameraX,canvas.height);ctx.stroke();}
  for(let y=sy;y<cameraY+canvas.height+T;y+=T){ctx.beginPath();ctx.moveTo(0,y-cameraY);ctx.lineTo(canvas.width,y-cameraY);ctx.stroke();}
}

function drawWalls(){
  for(const w of walls){
    const sx=w.x-cameraX,sy=w.y-cameraY;
    if(sx>canvas.width||sy>canvas.height||sx+w.w<0||sy+w.h<0) continue;
    const isBorder=w.x===0||w.y===0||w.x+w.w===MAP_W||w.y+w.h===MAP_H;
    const isCrate=w.w<=80&&w.h<=80&&!isBorder;
    if(isBorder){ctx.fillStyle='#1a1a2e';ctx.fillRect(sx,sy,w.w,w.h);}
    else if(isCrate){
      ctx.fillStyle='#3a2a1a';ctx.fillRect(sx,sy,w.w,w.h);
      ctx.strokeStyle='#8b5e3c';ctx.lineWidth=2;ctx.strokeRect(sx+2,sy+2,w.w-4,w.h-4);
      ctx.strokeStyle='#6b4e2c';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(sx+6,sy+6);ctx.lineTo(sx+w.w-6,sy+w.h-6);
      ctx.moveTo(sx+w.w-6,sy+6);ctx.lineTo(sx+6,sy+w.h-6);ctx.stroke();
    } else {
      ctx.fillStyle='#1e2035';ctx.fillRect(sx,sy,w.w,w.h);
      ctx.strokeStyle='#3a3a5a';ctx.lineWidth=2;ctx.strokeRect(sx,sy,w.w,w.h);
      ctx.fillStyle='rgba(255,220,100,0.22)';
      for(let wx=sx+16;wx<sx+w.w-16;wx+=24)
        for(let wy=sy+16;wy<sy+w.h-16;wy+=24)
          ctx.fillRect(wx,wy,8,8);
    }
  }
}

function drawLoot(){
  if(!gameData?.loot) return;
  const t=Date.now()/1000;
  for(const item of gameData.loot){
    const sx=item.x-cameraX,sy=item.y-cameraY;
    if(sx<-40||sx>canvas.width+40||sy<-40||sy>canvas.height+40) continue;
    const bob=Math.sin(t*2+item.x*0.01)*3;
    ctx.save();
    ctx.shadowBlur=14;ctx.shadowColor=RARITY_GLOW[item.rarity]||'rgba(255,255,255,0.3)';
    ctx.strokeStyle=item.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(sx,sy+bob,14,0,Math.PI*2);ctx.stroke();
    ctx.restore();
    ctx.fillStyle='rgba(10,10,20,0.85)';
    ctx.beginPath();ctx.arc(sx,sy+bob,13,0,Math.PI*2);ctx.fill();
    ctx.font='15px serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(item.weaponEmoji||item.emoji||'?',sx,sy+bob);
    ctx.font="9px 'Press Start 2P',monospace";
    ctx.fillStyle=item.color;ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText((item.rarity||'').slice(0,3).toUpperCase(),sx,sy+bob+16);
  }
}

function drawGrenades(){
  if(!gameData?.grenades) return;
  const now=Date.now();
  for(const g of gameData.grenades){
    const sx=g.x-cameraX,sy=g.y-cameraY;
    const timeLeft=(g.explodeAt-now)/1000;
    const flash=timeLeft<1&&Math.floor(Date.now()/100)%2===0;
    ctx.save();
    ctx.fillStyle=flash?'#ff4400':'#88ff44';
    ctx.shadowBlur=flash?16:8;ctx.shadowColor=flash?'#ff4400':'#88ff44';
    ctx.beginPath();ctx.arc(sx,sy,7,0,Math.PI*2);ctx.fill();
    ctx.font='10px serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('💣',sx,sy);
    ctx.restore();
    // Fuse timer arc
    if(timeLeft>0){
      ctx.save();ctx.strokeStyle='rgba(255,200,0,0.6)';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(sx,sy,11,-Math.PI/2,-Math.PI/2+(timeLeft/2.5)*Math.PI*2);ctx.stroke();
      ctx.restore();
    }
  }
}

function drawExplosions(){
  for(const e of explosions){
    ctx.save();ctx.globalAlpha=e.life*0.6;
    const grad=ctx.createRadialGradient(e.x-cameraX,e.y-cameraY,0,e.x-cameraX,e.y-cameraY,e.r*e.life);
    grad.addColorStop(0,'rgba(255,220,100,0.9)');
    grad.addColorStop(0.4,'rgba(255,80,0,0.6)');
    grad.addColorStop(1,'rgba(255,30,0,0)');
    ctx.fillStyle=grad;
    ctx.beginPath();ctx.arc(e.x-cameraX,e.y-cameraY,e.r,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
}

function drawZone(zone){
  if(!zone) return;
  const sx=zone.x-cameraX,sy=zone.y-cameraY;
  ctx.save();ctx.fillStyle='rgba(255,30,30,0.07)';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath();ctx.arc(sx,sy,zone.r,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,1)';ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle=`rgba(255,50,50,${0.5+0.3*Math.sin(Date.now()/300)})`;
  ctx.lineWidth=3;ctx.setLineDash([12,8]);ctx.lineDashOffset=-(Date.now()/20)%20;
  ctx.beginPath();ctx.arc(sx,sy,zone.r,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
}

function drawBullets(){
  if(!gameData?.bullets) return;
  for(const b of gameData.bullets){
    const sx=b.x-cameraX,sy=b.y-cameraY;
    ctx.save();ctx.fillStyle=b.color||'#ffcc00';ctx.shadowBlur=10;ctx.shadowColor=b.color||'#ffcc00';
    ctx.beginPath();ctx.arc(sx,sy,b.size||5,0,Math.PI*2);ctx.fill();ctx.restore();
  }
}

function drawPlayers(){
  if(!gameData?.players) return;
  for(const[id,p]of Object.entries(gameData.players)){
    if(p.eliminated&&!p.ghost) continue;
    if(!p.alive&&!p.ghost) continue;
    const sx=p.x-cameraX,sy=p.y-cameraY;
    const isMe=id===myId;
    const isGhost=p.ghost;

    ctx.save();ctx.translate(sx,sy);

    if(isGhost){
      // Ghost rendering — translucent, floating
      ctx.globalAlpha=0.5+0.2*Math.sin(Date.now()/200);
      ctx.shadowBlur=20;ctx.shadowColor='#aaffee';
      ctx.fillStyle='#aaffee';
      ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
      ctx.globalAlpha=1;
      // Ghost progress ring
      const pct=p.ghostItems/5;
      ctx.strokeStyle='#00ffaa';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,21,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);ctx.stroke();
      // Ghost label
      ctx.font="11px 'VT323',monospace";ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='#aaffee';ctx.fillText('👻',0,0);
      ctx.restore();
      // Name
      ctx.save();ctx.globalAlpha=0.7;
      ctx.font="13px 'VT323',monospace";ctx.textAlign='center';
      ctx.fillStyle='#aaffee';ctx.fillText(p.name,sx,sy-28);
      ctx.restore();
      continue;
    }

    // Shadow
    ctx.fillStyle='rgba(0,0,0,0.35)';
    ctx.beginPath();ctx.ellipse(2,5,14,5,0,0,Math.PI*2);ctx.fill();

    // Shield ring
    if(p.shield>0){
      ctx.strokeStyle=`rgba(68,136,255,${0.4+0.4*(p.shield/50)})`;
      ctx.lineWidth=3;ctx.shadowBlur=10;ctx.shadowColor='#4488ff';
      ctx.beginPath();ctx.arc(0,0,21,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
    }

    // Body
    ctx.fillStyle=p.color;
    if(isMe){ctx.shadowBlur=14;ctx.shadowColor=p.color;}
    ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=isMe?'#fff':'rgba(255,255,255,0.4)';ctx.lineWidth=isMe?2.5:1;ctx.stroke();ctx.shadowBlur=0;
    ctx.fillStyle='rgba(0,0,0,0.55)';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();

    // Gun
    ctx.rotate(p.angle||0);
    ctx.fillStyle=isMe?'#fff':'rgba(255,255,255,0.7)';ctx.fillRect(8,-3,18,6);
    ctx.fillStyle='rgba(0,0,0,0.3)';ctx.fillRect(12,-1,14,2);
    ctx.restore();

    // Name + HP bar
    ctx.save();
    ctx.font="13px 'VT323',monospace";ctx.textAlign='center';
    ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(sx-32,sy-37,64,16);
    ctx.fillStyle=isMe?'#ffcc00':'#e8e8ff';ctx.fillText(p.name,sx,sy-24);
    ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(sx-22,sy-47,44,5);
    ctx.fillStyle=p.hp>50?'#44ffaa':p.hp>25?'#ffcc00':'#ff4444';
    ctx.fillRect(sx-22,sy-47,(p.hp/100)*44,5);
    ctx.restore();
  }
}

function drawParticles(){
  for(const p of particles){
    ctx.save();ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.shadowBlur=4;ctx.shadowColor=p.color;
    ctx.beginPath();ctx.arc(p.x-cameraX,p.y-cameraY,p.size*p.life,0,Math.PI*2);ctx.fill();ctx.restore();
  }
}

function drawPickupNotifs(){
  for(const n of pickupNotifs){
    const sx=n.x-cameraX,sy=n.y-cameraY;
    ctx.save();ctx.globalAlpha=n.t;
    ctx.font="18px 'VT323',monospace";ctx.textAlign='center';
    const w=ctx.measureText(n.msg).width;
    ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(sx-w/2-4,sy-16,w+8,20);
    ctx.fillStyle=n.color;ctx.fillText(n.msg,sx,sy);ctx.restore();
  }
}

function drawMinimap(){
  const W=minimap.width,H=minimap.height,scaleX=W/MAP_W,scaleY=H/MAP_H;
  mmCtx.fillStyle='rgba(10,10,20,0.9)';mmCtx.fillRect(0,0,W,H);
  mmCtx.fillStyle='#2a2a4a';
  for(const w of walls) mmCtx.fillRect(w.x*scaleX,w.y*scaleY,Math.max(1,w.w*scaleX),Math.max(1,w.h*scaleY));
  if(gameData?.loot){
    for(const l of gameData.loot){mmCtx.fillStyle=l.color||'#ffcc44';mmCtx.fillRect(l.x*scaleX-1,l.y*scaleY-1,3,3);}
  }
  if(gameData?.zone){
    const z=gameData.zone;mmCtx.strokeStyle='rgba(255,50,50,0.8)';mmCtx.lineWidth=1.5;
    mmCtx.beginPath();mmCtx.arc(z.x*scaleX,z.y*scaleY,z.r*scaleX,0,Math.PI*2);mmCtx.stroke();
  }
  if(gameData?.players){
    for(const[id,p]of Object.entries(gameData.players)){
      if(!p.alive&&!p.ghost) continue;
      mmCtx.fillStyle=p.ghost?'#aaffee':(id===myId?'#fff':p.color);
      mmCtx.beginPath();mmCtx.arc(p.x*scaleX,p.y*scaleY,id===myId?4:2.5,0,Math.PI*2);mmCtx.fill();
    }
  }
  mmCtx.strokeStyle='rgba(255,255,255,0.2)';mmCtx.lineWidth=1;
  mmCtx.strokeRect(cameraX*scaleX,cameraY*scaleY,canvas.width*scaleX,canvas.height*scaleY);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
function gameLoop(){
  requestAnimationFrame(gameLoop);
  if(!joined||!myId||!gameData) return;

  const me=gameData.players?.[myId];
  if(me){
    cameraX+=(me.x-canvas.width/2-cameraX)*0.1;
    cameraY+=(me.y-canvas.height/2-cameraY)*0.1;
    cameraX=Math.max(0,Math.min(MAP_W-canvas.width,cameraX));
    cameraY=Math.max(0,Math.min(MAP_H-canvas.height,cameraY));
    worldMouseX=mouseX+cameraX;worldMouseY=mouseY+cameraY;
  }

  updateFX();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBg();
  drawZone(gameData.zone);
  drawExplosions();
  drawWalls();
  drawLoot();
  drawParticles();
  drawBullets();
  drawGrenades();
  drawPlayers();
  drawPickupNotifs();

  // Crosshair (only when alive, not ghost)
  if(me?.alive&&!me?.ghost){
    ctx.save();ctx.strokeStyle='rgba(255,255,255,0.75)';ctx.lineWidth=1.5;
    const cs=10,cg=5;
    ctx.beginPath();
    ctx.moveTo(mouseX-cs-cg,mouseY);ctx.lineTo(mouseX-cg,mouseY);
    ctx.moveTo(mouseX+cg,mouseY);ctx.lineTo(mouseX+cs+cg,mouseY);
    ctx.moveTo(mouseX,mouseY-cs-cg);ctx.lineTo(mouseX,mouseY-cg);
    ctx.moveTo(mouseX,mouseY+cg);ctx.lineTo(mouseX,mouseY+cs+cg);
    ctx.stroke();
    ctx.beginPath();ctx.arc(mouseX,mouseY,2,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.75)';ctx.fill();ctx.restore();
  }

  drawMinimap();
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function joinGame(){
  const name=document.getElementById('nameInput').value.trim()||'PLAYER';
  socket.emit('join',{name});
  document.getElementById('lobby').style.display='none';
  document.getElementById('hud').style.display='flex';
  joined=true;
  document.activeElement?.blur();
}
document.getElementById('joinBtn').addEventListener('click',joinGame);
document.getElementById('nameInput').addEventListener('keydown',e=>{if(e.key==='Enter')joinGame();});
document.getElementById('restartBtn').addEventListener('click',()=>{
  socket.emit('startGame');
  document.getElementById('overlay').classList.remove('show');
});
window.addEventListener('load',()=>{document.getElementById('nameInput').focus();});

gameLoop();
