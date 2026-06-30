# Laud

A synchronized video-watching web platform — a Rave-like app. Watch YouTube and VK videos together in real time, with chat and rooms.

![Node.js](https://img.shields.io/badge/Backend-Node.js-339933)
![Vite](https://img.shields.io/badge/Frontend-Vite-646CFF)
![WebSocket](https://img.shields.io/badge/Realtime-WebSocket-black)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7)

---

## About

Laud lets you watch YouTube and VK videos together with friends: create a room, drop a link, and the player syncs for everyone in the room — pause, seek, and changing videos instantly reflect for all participants. Each room has a built-in chat to discuss what's happening on screen.

## Features

- Create rooms for watching together
- Playback sync (play/pause/seek) across all room participants
- Support for two video sources: YouTube and VK
- Built-in real-time chat
- Dark, minimalist interface

## Tech Stack

- **Backend:** Node.js (WebSocket server for state synchronization)
- **Frontend:** Vite + JavaScript
- **Realtime:** WebSocket connections for syncing the player and chat
- **Deployment:** Render — backend and frontend run as two independent services

## Architecture

The project consists of two standalone parts deployed separately:

```
laud/
  server.js       ← WebSocket + REST backend
  package.json
  src/             ← frontend (Vite)
  dist/            ← built frontend bundle
```

**Backend (Web Service on Render)**
- Holds room state and syncs playback between clients via WebSocket
- Serves REST endpoints for creating/finding rooms
- Port is read from `process.env.PORT`

**Frontend (Static Site on Render)**
- Built via `vite build`, served as static files
- The backend address is passed through the `VITE_SERVER_URL` environment variable, so the frontend knows where to connect after deployment

## Running locally

```bash
git clone https://github.com/<your-username>/laud.git
cd laud
npm install
```

**Backend:**
```bash
node server.js
```

**Frontend:**
```bash
npm run dev
```

Don't forget to set `VITE_SERVER_URL` in the frontend's `.env` so it points to your local backend.

## Deployment

[The project deploys to Render as two independent services — backend as a Web Service, frontend as a Static Site. Configuration details (build/start commands) are in the comments of each part's `package.json`.
]
https://laud-client.onrender.com
<img width="1437" height="778" alt="Screenshot 2026-06-22 at 20 18 07" src="https://github.com/user-attachments/assets/1c2f8b28-9efd-4d80-a836-8cc6e270d130" />
<img width="1440" height="783" alt="Screenshot 2026-06-22 at 20 20 50" src="https://github.com/user-attachments/assets/4e92f36f-a3ca-4fc0-aa8b-e1b8988bea81" />)

## Roadmap

- Support for additional video platforms
- Room watch history
- Reactions and emoji over the video
