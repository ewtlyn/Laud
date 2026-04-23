const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(
  cors({
    origin: "*"
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

app.get("/", (req, res) => {
  res.send("LAUD server is running");
});

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSystemMessage(text) {
  return {
    id: createId("msg"),
    username: "Система",
    message: text,
    type: "text",
    gifUrl: "",
    replyTo: null,
    system: true,
    time: new Date().toLocaleTimeString(),
    createdAt: Date.now()
  };
}

function getRoomSnapshot(roomId) {
  const room = rooms[roomId];
  if (!room) {
    return {
      ok: false
    };
  }

  return {
    ok: true,
    users: room.users,
    hostClientId: room.hostClientId,
    videoState: room.videoState,
    messages: room.messages
  };
}

function removeUserFromRoom(socket) {
  const roomId = socket.roomId;
  if (!roomId || !rooms[roomId]) return;

  const room = rooms[roomId];
  const leftUserName = socket.username || "Гость";
  const leftClientId = socket.clientId;

  room.users = room.users.map((user) =>
    user.clientId === leftClientId ? { ...user, isOnline: false } : user
  );

  const onlineUsers = room.users.filter((user) => user.isOnline);

  if (onlineUsers.length > 0 && room.hostClientId === leftClientId) {
    room.hostClientId = onlineUsers[0].clientId;

    io.to(roomId).emit("host_data", {
      hostClientId: room.hostClientId
    });

    const hostMessage = createSystemMessage(
      `${onlineUsers[0].username} теперь хост комнаты`
    );

    room.messages.push(hostMessage);
    io.to(roomId).emit("receive_message", hostMessage);
  }

  io.to(roomId).emit("room_users", room.users);

  if (onlineUsers.length > 0) {
    const leaveMessage = createSystemMessage(`${leftUserName} покинул комнату`);
    room.messages.push(leaveMessage);
    io.to(roomId).emit("receive_message", leaveMessage);
  }

  if (onlineUsers.length === 0) {
    delete rooms[roomId];
  }
}

io.on("connection", (socket) => {
  console.log("Пользователь подключился:", socket.id);

  socket.on("join_room", ({ roomId, username, clientId }, callback) => {
    if (!roomId) {
      callback?.({ ok: false, error: "NO_ROOM_ID" });
      return;
    }

    const safeUsername = (username || "Гость").trim() || "Гость";
    const safeClientId = (clientId || createId("client")).trim();

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostClientId: safeClientId,
        users: [],
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

    const room = rooms[roomId];

    const existingUserIndex = room.users.findIndex(
      (user) => user.clientId === safeClientId
    );

    if (existingUserIndex >= 0) {
      room.users[existingUserIndex] = {
        ...room.users[existingUserIndex],
        id: socket.id,
        username: safeUsername,
        isOnline: true
      };
    } else {
      room.users.push({
        id: socket.id,
        clientId: safeClientId,
        username: safeUsername,
        isOnline: true
      });
    }

    socket.roomId = roomId;
    socket.username = safeUsername;
    socket.clientId = safeClientId;

    io.to(roomId).emit("room_users", room.users);
    io.to(roomId).emit("host_data", {
      hostClientId: room.hostClientId
    });

    socket.emit("room_snapshot", {
      users: room.users,
      hostClientId: room.hostClientId,
      videoState: room.videoState,
      messages: room.messages
    });

    const joinMessage = createSystemMessage(
      `${safeUsername} присоединился к комнате`
    );

    room.messages.push(joinMessage);
    io.to(roomId).emit("receive_message", joinMessage);

    callback?.({ ok: true });
    console.log(`${safeUsername} вошел в комнату ${roomId}`);
  });

  socket.on("get_room_state", ({ roomId }, callback) => {
    callback?.(getRoomSnapshot(roomId));
  });

  socket.on("leave_room", () => {
    removeUserFromRoom(socket);
  });

  socket.on("set_video", ({ roomId, videoUrl, videoType }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false, error: "ROOM_NOT_FOUND" });
      return;
    }

    if (rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false, error: "NOT_HOST" });
      return;
    }

    rooms[roomId].videoState.videoUrl = videoUrl || "";
    rooms[roomId].videoState.videoType = videoType || "file";
    rooms[roomId].videoState.currentTime = 0;
    rooms[roomId].videoState.isPlaying = false;
    rooms[roomId].videoState.lastActionAt = Date.now();

    io.to(roomId).emit("video_state", rooms[roomId].videoState);

    const systemMessage = createSystemMessage(
      `${socket.username} установил новое видео`
    );

    rooms[roomId].messages.push(systemMessage);
    io.to(roomId).emit("receive_message", systemMessage);

    callback?.({ ok: true });
  });

  socket.on("play_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false });
      return;
    }

    rooms[roomId].videoState.isPlaying = true;
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();

    io.to(roomId).emit("play_video", {
      currentTime: currentTime || 0,
      lastActionAt: rooms[roomId].videoState.lastActionAt
    });

    callback?.({ ok: true });
  });

  socket.on("pause_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false });
      return;
    }

    rooms[roomId].videoState.isPlaying = false;
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();

    io.to(roomId).emit("pause_video", {
      currentTime: currentTime || 0,
      lastActionAt: rooms[roomId].videoState.lastActionAt
    });

    callback?.({ ok: true });
  });

  socket.on("seek_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false });
      return;
    }

    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();

    io.to(roomId).emit("seek_video", {
      currentTime: currentTime || 0,
      lastActionAt: rooms[roomId].videoState.lastActionAt
    });

    callback?.({ ok: true });
  });

  socket.on("sync_progress", ({ roomId, currentTime, isPlaying }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false });
      return;
    }

    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.isPlaying = Boolean(isPlaying);
    rooms[roomId].videoState.lastActionAt = Date.now();

    socket.to(roomId).emit("sync_progress", {
      currentTime: currentTime || 0,
      isPlaying: Boolean(isPlaying),
      lastActionAt: rooms[roomId].videoState.lastActionAt
    });

    callback?.({ ok: true });
  });

  socket.on(
    "send_message",
    ({ roomId, username, message, clientMessageId, replyTo, type, gifUrl }, callback) => {
      if (!rooms[roomId]) {
        callback?.({ ok: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      const safeType = type === "gif" ? "gif" : "text";
      const safeMessage = typeof message === "string" ? message.trim() : "";
      const safeGifUrl = typeof gifUrl === "string" ? gifUrl.trim() : "";

      if (safeType === "text" && !safeMessage) {
        callback?.({ ok: false, error: "EMPTY_TEXT" });
        return;
      }

      if (safeType === "gif" && !safeGifUrl) {
        callback?.({ ok: false, error: "EMPTY_GIF" });
        return;
      }

      const payload = {
        id: clientMessageId || createId("msg"),
        username: (username || "Гость").trim() || "Гость",
        type: safeType,
        message: safeType === "text" ? safeMessage : "",
        gifUrl: safeType === "gif" ? safeGifUrl : "",
        replyTo: replyTo
          ? {
              id: replyTo.id || "",
              username: replyTo.username || "Пользователь",
              message: replyTo.message || "",
              type: replyTo.type || "text",
              gifUrl: replyTo.gifUrl || ""
            }
          : null,
        time: new Date().toLocaleTimeString(),
        createdAt: Date.now()
      };

      rooms[roomId].messages.push(payload);
      io.to(roomId).emit("receive_message", payload);

      callback?.({ ok: true });
    }
  );

  socket.on("disconnect", () => {
    removeUserFromRoom(socket);
    console.log("Пользователь отключился:", socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`LAUD server запущен на порту ${PORT}`);
});