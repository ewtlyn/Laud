const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"],
  pingInterval: 10000,
  pingTimeout: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

const rooms = {};
const DISCONNECT_GRACE_MS = 30000;
const MAX_MESSAGES = 100;

app.get("/", (req, res) => {
  res.send("LAUD server is running");
});

function createSystemMessage(text) {
  return {
    id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    username: "Система",
    message: text,
    time: new Date().toLocaleTimeString(),
    system: true
  };
}

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      hostClientId: null,
      users: [],
      pendingDisconnects: {},
      messages: [],
      videoState: {
        isPlaying: false,
        currentTime: 0,
        videoUrl: "",
        videoType: "file",
        lastActionAt: Date.now()
      }
    };
  }

  return rooms[roomId];
}

function addMessage(room, msg) {
  room.messages.push(msg);

  if (room.messages.length > MAX_MESSAGES) {
    room.messages = room.messages.slice(-MAX_MESSAGES);
  }
}

function emitRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit(
    "room_users",
    room.users.map((u) => ({
      id: u.id,
      clientId: u.clientId,
      username: u.username,
      isOnline: u.isOnline
    }))
  );

  io.to(roomId).emit("host_data", {
    hostClientId: room.hostClientId
  });
}

function removeUserFinally(roomId, clientId) {
  const room = rooms[roomId];
  if (!room) return;

  const user = room.users.find((u) => u.clientId === clientId);
  if (!user) return;

  room.users = room.users.filter((u) => u.clientId !== clientId);

  if (room.hostClientId === clientId) {
    const nextHost = room.users.find((u) => u.isOnline) || room.users[0] || null;
    room.hostClientId = nextHost ? nextHost.clientId : null;

    if (nextHost) {
      const msg = createSystemMessage(`${nextHost.username} теперь хост комнаты`);
      addMessage(room, msg);
      io.to(roomId).emit("receive_message", msg);
    }
  }

  emitRoomState(roomId);

  if (room.users.length > 0) {
    const leaveMsg = createSystemMessage(`${user.username} покинул комнату`);
    addMessage(room, leaveMsg);
    io.to(roomId).emit("receive_message", leaveMsg);
  }

  if (room.users.length === 0) {
    delete rooms[roomId];
  }
}

function scheduleDisconnect(socket) {
  const roomId = socket.roomId;
  const clientId = socket.clientId;
  if (!roomId || !clientId || !rooms[roomId]) return;

  const room = rooms[roomId];
  const user = room.users.find((u) => u.clientId === clientId);
  if (!user) return;

  user.isOnline = false;
  emitRoomState(roomId);

  if (room.pendingDisconnects[clientId]) {
    clearTimeout(room.pendingDisconnects[clientId]);
  }

  room.pendingDisconnects[clientId] = setTimeout(() => {
    delete room.pendingDisconnects[clientId];
    removeUserFinally(roomId, clientId);
  }, DISCONNECT_GRACE_MS);
}

io.on("connection", (socket) => {
  console.log("Пользователь подключился:", socket.id);

  socket.on("join_room", ({ roomId, username, clientId }, ack) => {
    if (!roomId) {
      ack?.({ ok: false, error: "ROOM_ID_REQUIRED" });
      return;
    }

    const safeUsername = (username || "Гость").trim() || "Гость";
    const safeClientId = (clientId || socket.id).toString();
    const room = ensureRoom(roomId);

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = safeUsername;
    socket.clientId = safeClientId;

    if (room.pendingDisconnects[safeClientId]) {
      clearTimeout(room.pendingDisconnects[safeClientId]);
      delete room.pendingDisconnects[safeClientId];
    }

    let user = room.users.find((u) => u.clientId === safeClientId);

    if (user) {
      user.id = socket.id;
      user.username = safeUsername;
      user.isOnline = true;
    } else {
      user = {
        id: socket.id,
        clientId: safeClientId,
        username: safeUsername,
        isOnline: true
      };
      room.users.push(user);
    }

    if (!room.hostClientId) {
      room.hostClientId = safeClientId;
    }

    emitRoomState(roomId);

    socket.emit("room_snapshot", {
      users: room.users,
      hostClientId: room.hostClientId,
      videoState: room.videoState,
      messages: room.messages
    });

let user = room.users.find((u) => u.clientId === safeClientId);
const isReconnect = Boolean(user);

if (user) {
  user.id = socket.id;
  user.username = safeUsername;
  user.isOnline = true;
} else {
  user = {
    id: socket.id,
    clientId: safeClientId,
    username: safeUsername,
    isOnline: true
  };
  room.users.push(user);
}

if (!room.hostClientId) {
  room.hostClientId = safeClientId;
}

emitRoomState(roomId);

socket.emit("room_snapshot", {
  users: room.users,
  hostClientId: room.hostClientId,
  videoState: room.videoState,
  messages: room.messages
});

if (!isReconnect) {
  const joinMsg = createSystemMessage(`${safeUsername} присоединился к комнате`);
  addMessage(room, joinMsg);
  io.to(roomId).emit("receive_message", joinMsg);
}

    ack?.({ ok: true });
    console.log(`${safeUsername} вошел в комнату ${roomId}`);
  });

  socket.on("leave_room", () => {
    if (socket.roomId && socket.clientId) {
      removeUserFinally(socket.roomId, socket.clientId);
    }
  });

  socket.on("set_video", ({ roomId, videoUrl, videoType }, ack) => {
    const room = rooms[roomId];
    if (!room) {
      ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
      return;
    }

    if (room.hostClientId !== socket.clientId) {
      ack?.({ ok: false, error: "ONLY_HOST_CAN_SET_VIDEO" });
      return;
    }

    room.videoState = {
      videoUrl: videoUrl || "",
      videoType: videoType || "file",
      currentTime: 0,
      isPlaying: false,
      lastActionAt: Date.now()
    };

    io.to(roomId).emit("video_state", room.videoState);

    const msg = createSystemMessage(`${socket.username} установил новое видео`);
    addMessage(room, msg);
    io.to(roomId).emit("receive_message", msg);

    ack?.({ ok: true });
  });

  socket.on("play_video", ({ roomId, currentTime }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack?.({ ok: false, error: "ROOM_NOT_FOUND" });

    if (room.hostClientId !== socket.clientId) {
      return ack?.({ ok: false, error: "ONLY_HOST_CAN_CONTROL_PLAYBACK" });
    }

    room.videoState.isPlaying = true;
    room.videoState.currentTime = Number(currentTime) || 0;
    room.videoState.lastActionAt = Date.now();

    socket.to(roomId).emit("play_video", {
      currentTime: room.videoState.currentTime,
      emittedAt: room.videoState.lastActionAt
    });

    ack?.({ ok: true });
  });

  socket.on("pause_video", ({ roomId, currentTime }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack?.({ ok: false, error: "ROOM_NOT_FOUND" });

    if (room.hostClientId !== socket.clientId) {
      return ack?.({ ok: false, error: "ONLY_HOST_CAN_CONTROL_PLAYBACK" });
    }

    room.videoState.isPlaying = false;
    room.videoState.currentTime = Number(currentTime) || 0;
    room.videoState.lastActionAt = Date.now();

    socket.to(roomId).emit("pause_video", {
      currentTime: room.videoState.currentTime,
      emittedAt: room.videoState.lastActionAt
    });

    ack?.({ ok: true });
  });

  socket.on("seek_video", ({ roomId, currentTime }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack?.({ ok: false, error: "ROOM_NOT_FOUND" });

    if (room.hostClientId !== socket.clientId) {
      return ack?.({ ok: false, error: "ONLY_HOST_CAN_CONTROL_PLAYBACK" });
    }

    room.videoState.currentTime = Number(currentTime) || 0;
    room.videoState.lastActionAt = Date.now();

    socket.to(roomId).emit("seek_video", {
      currentTime: room.videoState.currentTime,
      emittedAt: room.videoState.lastActionAt
    });

    ack?.({ ok: true });
  });

  socket.on("sync_progress", ({ roomId, currentTime, isPlaying }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostClientId !== socket.clientId) return;

    room.videoState.currentTime = Number(currentTime) || 0;
    room.videoState.isPlaying = Boolean(isPlaying);
    room.videoState.lastActionAt = Date.now();

    socket.to(roomId).volatile.emit("sync_progress", {
      currentTime: room.videoState.currentTime,
      isPlaying: room.videoState.isPlaying,
      emittedAt: room.videoState.lastActionAt
    });
  });

  socket.on("send_message", ({ roomId, username, message, clientMessageId }, ack) => {
    const room = rooms[roomId];
    if (!room) {
      ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
      return;
    }

    const trimmed = (message || "").trim();
    if (!trimmed) {
      ack?.({ ok: false, error: "EMPTY_MESSAGE" });
      return;
    }

    const payload = {
      id: clientMessageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      username: (username || socket.username || "Гость").trim() || "Гость",
      message: trimmed,
      time: new Date().toLocaleTimeString(),
      system: false
    };

    addMessage(room, payload);
    io.to(roomId).emit("receive_message", payload);
    ack?.({ ok: true, messageId: payload.id });
  });

  socket.on("get_room_state", ({ roomId }, ack) => {
    const room = rooms[roomId];
    if (!room) {
      ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
      return;
    }

    ack?.({
      ok: true,
      users: room.users,
      hostClientId: room.hostClientId,
      videoState: room.videoState,
      messages: room.messages
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("Пользователь отключился:", socket.id, reason);
    scheduleDisconnect(socket);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`LAUD server запущен на порту ${PORT}`);
});