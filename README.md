# 🎮 ZONE — Retro Battle Royale

A real-time 2D multiplayer battle royale game. Up to 12+ players, shrinking zone, pixel art aesthetic.

## How to Play
- **WASD / Arrow Keys** — Move
- **Mouse** — Aim
- **Left Click / Hold** — Shoot
- Last player alive wins!

## Features
- Real-time multiplayer via Socket.io
- Shrinking danger zone
- Buildings & crates for cover
- Kill feed & minimap
- Particle effects
- 10 player colors

---

## 🚀 Deploy to Railway (Share with Friends)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit — ZONE Battle Royale"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/zone-battle-royale.git
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `zone-battle-royale` repo
4. Railway auto-detects Node.js and deploys!
5. Go to **Settings → Networking** → click **"Generate Domain"**
6. Share the URL with friends — they can play instantly in their browser!

### Step 3: Play!
Share the Railway URL. No installs needed. Just open and play!

---

## Run Locally
```bash
npm install
npm start
# Open http://localhost:3000
```

For dev with auto-reload:
```bash
npm run dev
```

---

## Architecture
- **Server**: Node.js + Express + Socket.io (60 tick rate)
- **Client**: HTML5 Canvas + vanilla JS
- **Hosting**: Railway (free tier available)
