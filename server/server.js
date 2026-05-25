const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

app.get("/", (req, res) => res.send("LAUD server is running"));

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

function detectVideoType(url) {
  if (!url) return "file";
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (
    lower.includes("vk.com/video_ext.php") ||
    lower.includes("vkvideo.ru/video_ext.php") ||
    lower.includes("vk.com/video") ||
    lower.includes("vkvideo.ru/video")
  ) return "vk";
  return "file";
}

function getRoomSnapshot(roomId) {
  const room = rooms[roomId];
  if (!room) return { ok: false };
  return {
    ok: true,
    users: room.users,
    hostClientId: room.hostClientId,
    videoState: room.videoState,
    messages: room.messages,
    settings: room.settings,
    suggestions: room.suggestions
  };
}

function removeUserFromRoom(socket) {
  const roomId = socket.roomId;
  if (!roomId || !rooms[roomId]) return;

  const room = rooms[roomId];
  const leftUserName = socket.username || "Гость";
  const leftClientId = socket.clientId;

  room.users = room.users.filter((u) => u.clientId !== leftClientId);
  room.suggestions = room.suggestions.filter((s) => s.clientId !== leftClientId);

  if (room.users.length > 0 && room.hostClientId === leftClientId) {
    room.hostClientId = room.users[0].clientId;
    io.to(roomId).emit("host_data", { hostClientId: room.hostClientId });
    const msg = createSystemMessage(`${room.users[0].username} теперь хост комнаты`);
    room.messages.push(msg);
    io.to(roomId).emit("receive_message", msg);
  }

  io.to(roomId).emit("room_users", room.users);

  if (room.users.length > 0) {
    const msg = createSystemMessage(`${leftUserName} покинул комнату`);
    room.messages.push(msg);
    io.to(roomId).emit("receive_message", msg);
  }

  if (room.users.length === 0) delete rooms[roomId];
}

io.on("connection", (socket) => {
  console.log("Подключился:", socket.id);

  socket.on("join_room", ({ roomId, username, clientId, avatar: avatarRaw }, callback) => {
    if (!roomId) { callback?.({ ok: false, error: "NO_ROOM_ID" }); return; }

    const safeUsername = (username || "Гость").trim() || "Гость";
    const safeClientId = (clientId || createId("client")).trim();
    const safeAvatar = typeof avatarRaw === "string" && avatarRaw.startsWith("data:image/") ? avatarRaw : "";

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostClientId: safeClientId,
        users: [],
        messages: [],
        videoState: { isPlaying: false, currentTime: 0, videoUrl: "", videoType: "file", lastActionAt: Date.now() },
        settings: { allowParticipantControls: true, allowVideoSuggestions: true },
        suggestions: []
      };
    }

    const room = rooms[roomId];
    const existingIdx = room.users.findIndex((u) => u.clientId === safeClientId);

    if (existingIdx >= 0) {
      room.users[existingIdx] = {
        ...room.users[existingIdx],
        id: socket.id,
        username: safeUsername,
        avatar: safeAvatar || room.users[existingIdx].avatar || "",
        isOnline: true
      };
    } else {
      room.users.push({ id: socket.id, clientId: safeClientId, username: safeUsername, avatar: safeAvatar, isOnline: true });
    }

    socket.roomId = roomId;
    socket.username = safeUsername;
    socket.clientId = safeClientId;
    socket.avatar = safeAvatar;

    io.to(roomId).emit("room_users", room.users);
    io.to(roomId).emit("host_data", { hostClientId: room.hostClientId });

    socket.emit("room_snapshot", {
      users: room.users,
      hostClientId: room.hostClientId,
      videoState: room.videoState,
      messages: room.messages,
      settings: room.settings,
      suggestions: room.suggestions
    });

    const joinMsg = createSystemMessage(`${safeUsername} присоединился к комнате`);
    room.messages.push(joinMsg);
    io.to(roomId).emit("receive_message", joinMsg);

    callback?.({ ok: true });
    console.log(`${safeUsername} вошел в комнату ${roomId}`);
  });

  socket.on("get_room_state", ({ roomId }, callback) => {
    callback?.(getRoomSnapshot(roomId));
  });

  socket.on("leave_room", () => {
    removeUserFromRoom(socket);
  });

  socket.on("update_room_settings", ({ roomId, settings }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false }); return;
    }
    const s = rooms[roomId].settings;
    if (typeof settings?.allowParticipantControls === "boolean")
      s.allowParticipantControls = settings.allowParticipantControls;
    if (typeof settings?.allowVideoSuggestions === "boolean") {
      s.allowVideoSuggestions = settings.allowVideoSuggestions;
      if (!settings.allowVideoSuggestions) rooms[roomId].suggestions = [];
    }
    io.to(roomId).emit("room_settings", s);
    callback?.({ ok: true });
  });

  socket.on("transfer_host", ({ roomId, targetClientId }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false }); return;
    }
    const target = rooms[roomId].users.find((u) => u.clientId === targetClientId);
    if (!target) { callback?.({ ok: false }); return; }

    rooms[roomId].hostClientId = targetClientId;
    io.to(roomId).emit("host_data", { hostClientId: targetClientId });

    const msg = createSystemMessage(`${socket.username} передал права хоста пользователю ${target.username}`);
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit("receive_message", msg);
    callback?.({ ok: true });
  });

  socket.on("kick_user", ({ roomId, targetClientId }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false }); return;
    }
    if (targetClientId === socket.clientId) { callback?.({ ok: false }); return; }

    const targetSocket = [...io.sockets.sockets.values()].find(
      (s) => s.roomId === roomId && s.clientId === targetClientId
    );

    const target = rooms[roomId].users.find((u) => u.clientId === targetClientId);
    if (!target) { callback?.({ ok: false }); return; }

    const msg = createSystemMessage(`${socket.username} выгнал ${target.username} из комнаты`);
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit("receive_message", msg);

    if (targetSocket) {
      targetSocket.emit("kicked");
      removeUserFromRoom(targetSocket);
      targetSocket.leave(roomId);
      targetSocket.roomId = null;
    } else {
      rooms[roomId].users = rooms[roomId].users.filter((u) => u.clientId !== targetClientId);
      io.to(roomId).emit("room_users", rooms[roomId].users);
    }

    callback?.({ ok: true });
  });

  socket.on("suggest_video", ({ roomId, videoUrl }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false }); return; }
    if (!rooms[roomId].settings.allowVideoSuggestions) {
      callback?.({ ok: false, error: "SUGGESTIONS_DISABLED" }); return;
    }
    const cleanUrl = (videoUrl || "").trim();
    if (!cleanUrl) { callback?.({ ok: false, error: "EMPTY_URL" }); return; }

    const suggestion = {
      id: createId("sug"),
      clientId: socket.clientId,
      username: socket.username || "Гость",
      videoUrl: cleanUrl,
      videoType: detectVideoType(cleanUrl)
    };
    rooms[roomId].suggestions.push(suggestion);

    const hostSocket = [...io.sockets.sockets.values()].find(
      (s) => s.roomId === roomId && s.clientId === rooms[roomId].hostClientId
    );
    hostSocket?.emit("new_suggestion", suggestion);
    callback?.({ ok: true });
  });

  socket.on("respond_suggestion", ({ roomId, suggestionId, approved }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false }); return;
    }
    const idx = rooms[roomId].suggestions.findIndex((s) => s.id === suggestionId);
    if (idx === -1) { callback?.({ ok: false }); return; }

    const sug = rooms[roomId].suggestions.splice(idx, 1)[0];

    if (approved) {
      rooms[roomId].videoState = { ...rooms[roomId].videoState, videoUrl: sug.videoUrl, videoType: sug.videoType, currentTime: 0, isPlaying: false, lastActionAt: Date.now() };
      io.to(roomId).emit("video_state", rooms[roomId].videoState);
      const msg = createSystemMessage(`${socket.username} принял видео от ${sug.username}`);
      rooms[roomId].messages.push(msg);
      io.to(roomId).emit("receive_message", msg);
    } else {
      const msg = createSystemMessage(`${socket.username} отклонил предложение от ${sug.username}`);
      rooms[roomId].messages.push(msg);
      io.to(roomId).emit("receive_message", msg);
    }

    const sugSocket = [...io.sockets.sockets.values()].find(
      (s) => s.roomId === roomId && s.clientId === sug.clientId
    );
    sugSocket?.emit("suggestion_response", { id: suggestionId, approved: Boolean(approved) });
    callback?.({ ok: true });
  });

  socket.on("set_video", ({ roomId, videoUrl, videoType }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false, error: "ROOM_NOT_FOUND" }); return; }
    if (rooms[roomId].hostClientId !== socket.clientId) { callback?.({ ok: false, error: "NOT_HOST" }); return; }

    rooms[roomId].videoState = { ...rooms[roomId].videoState, videoUrl: videoUrl || "", videoType: videoType || "file", currentTime: 0, isPlaying: false, lastActionAt: Date.now() };
    io.to(roomId).emit("video_state", rooms[roomId].videoState);

    const msg = createSystemMessage(`${socket.username} установил новое видео`);
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit("receive_message", msg);
    callback?.({ ok: true });
  });

  socket.on("play_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false }); return; }
    if (rooms[roomId].hostClientId !== socket.clientId && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" }); return;
    }
    rooms[roomId].videoState.isPlaying = true;
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();
    io.to(roomId).emit("play_video", { currentTime: currentTime || 0, lastActionAt: rooms[roomId].videoState.lastActionAt });
    callback?.({ ok: true });
  });

  socket.on("pause_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false }); return; }
    if (rooms[roomId].hostClientId !== socket.clientId && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" }); return;
    }
    rooms[roomId].videoState.isPlaying = false;
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();
    io.to(roomId).emit("pause_video", { currentTime: currentTime || 0, lastActionAt: rooms[roomId].videoState.lastActionAt });
    callback?.({ ok: true });
  });

  socket.on("seek_video", ({ roomId, currentTime }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false }); return; }
    if (rooms[roomId].hostClientId !== socket.clientId && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" }); return;
    }
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.lastActionAt = Date.now();
    io.to(roomId).emit("seek_video", { currentTime: currentTime || 0, lastActionAt: rooms[roomId].videoState.lastActionAt });
    callback?.({ ok: true });
  });

  socket.on("sync_progress", ({ roomId, currentTime, isPlaying }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false }); return; }
    rooms[roomId].videoState.currentTime = currentTime || 0;
    rooms[roomId].videoState.isPlaying = Boolean(isPlaying);
    rooms[roomId].videoState.lastActionAt = Date.now();
    socket.to(roomId).emit("sync_progress", { currentTime: currentTime || 0, isPlaying: Boolean(isPlaying), lastActionAt: rooms[roomId].videoState.lastActionAt });
    callback?.({ ok: true });
  });

  socket.on("send_message", ({ roomId, username, message, clientMessageId, replyTo, type, gifUrl }, callback) => {
    if (!rooms[roomId]) { callback?.({ ok: false, error: "ROOM_NOT_FOUND" }); return; }

    const safeType = type === "gif" ? "gif" : type === "image" ? "image" : "text";
    const safeMessage = typeof message === "string" ? message.trim() : "";
    const safeGifUrl = typeof gifUrl === "string" ? gifUrl.trim() : "";

    if (safeType === "text" && !safeMessage) { callback?.({ ok: false, error: "EMPTY_TEXT" }); return; }
    if ((safeType === "gif" || safeType === "image") && !safeGifUrl) { callback?.({ ok: false, error: "EMPTY_GIF" }); return; }

    const payload = {
      id: clientMessageId || createId("msg"),
      username: (username || "Гость").trim() || "Гость",
      avatar: socket.avatar || "",
      type: safeType,
      message: safeType === "text" ? safeMessage : "",
      gifUrl: (safeType === "gif" || safeType === "image") ? safeGifUrl : "",
      replyTo: replyTo ? { id: replyTo.id || "", username: replyTo.username || "Пользователь", message: replyTo.message || "", type: replyTo.type || "text", gifUrl: replyTo.gifUrl || "" } : null,
      time: new Date().toLocaleTimeString(),
      createdAt: Date.now()
    };

    rooms[roomId].messages.push(payload);
    io.to(roomId).emit("receive_message", payload);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    removeUserFromRoom(socket);
    console.log("Отключился:", socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`LAUD server запущен на порту ${PORT}`));
