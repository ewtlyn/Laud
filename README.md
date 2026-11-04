# Laud

A synchronized video-watching web platform, a Rave-like app. Watch YouTube and VK videos together in real time, with chat and rooms.

**Live version: [laud.lvkosp.ru](https://laud.lvkosp.ru)**

![Node.js](https://img.shields.io/badge/Backend-Node.js-339933)
![Vite](https://img.shields.io/badge/Frontend-Vite-646CFF)
![WebSocket](https://img.shields.io/badge/Realtime-WebSocket-black)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7)

![Laud home page]<img width="1440" height="780" alt="home" src="https://github.com/user-attachments/assets/9e8b0408-63c0-446e-834c-b7a95aedac48" />


![Laud room: player, chat, participants, queue]<img width="1440" height="777" alt="room" src="https://github.com/user-attachments/assets/58d5d6f5-a40d-4219-9047-d3d3933d4f74" />

---

## About

Laud lets you watch YouTube and VK videos together with friends: create a room, drop a link, and the player syncs for everyone in the room. Pause, seek, and changing videos instantly reflect for all participants. Each room has a built-in chat to discuss what's happening on screen.

Laud is part of the **LVKOSP** ecosystem: Telegram bots, a messenger and web services built and maintained by me. Messenger and social network: [lvkosp.ru](https://lvkosp.ru).

## Features

- Create rooms by pasting a video link, join by room code or link
- "Now watching" list of open rooms, search by room or video, categories (friends, movies, series, music, other)
- Playback sync (play/pause/seek) across all room participants
- Support for two video sources: YouTube and VK
- Host role: the host controls playback in the room
- Video queue and an "Add video" button during playback
- Built-in real-time chat with emoji and images, participants list, invite friends
- Reactions over the video (heart, laugh, fire, surprise, applause)
- Dark, minimalist, responsive interface

## Tech Stack

- **Backend:** Node.js (WebSocket server for state synchronization)
- **Frontend:** Vite + JavaScript
- **Realtime:** WebSocket connections for syncing the player and chat
- **Deployment:** Render. Backend and frontend run as two independent services

## Architecture

The project consists of two standalone parts deployed separately:

```
Laud/
  server/   ← WebSocket + REST backend
  client/   ← frontend (Vite)
```

**Backend (Web Service on Render)**
- Holds room state (current video, position, pause state, participants, queue) and syncs playback between clients via WebSocket
- Serves REST endpoints for creating and finding rooms
- Port is read from `process.env.PORT`

**Frontend (Static Site on Render)**
- Built via `vite build`, served as static files
- The backend address is passed through the `VITE_SERVER_URL` environment variable, so the frontend knows where to connect after deployment

## Running locally

```bash
git clone https://github.com/ewtlyn/Laud.git
cd Laud
```

**Backend:**
```bash
cd server
npm install
node server.js
```

**Frontend** (in a second terminal):
```bash
cd client
npm install
npm run dev
```

Create `client/.env` and point it to your local backend:

```
VITE_SERVER_URL=http://localhost:3001
```

Use the port your backend actually listens on.

## Deployment

The project deploys to Render as two independent services: the backend as a Web Service, the frontend as a Static Site. Build and start commands are in each part's `package.json`.

Live: [laud.lvkosp.ru](https://laud.lvkosp.ru)

## Status

This repository shows the core of the project. The current version with the updated design runs at [laud.lvkosp.ru](https://laud.lvkosp.ru) and is developed separately.

## Roadmap

- Support for additional video platforms
- Room watch history

## Author

Ekaterina, [@ewtlyn](https://t.me/ewtlyn) on Telegram, [GitHub](https://github.com/ewtlyn)
