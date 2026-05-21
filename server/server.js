const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const ytdl = require("@distube/ytdl-core");

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

app.get("/api/youtube-stream/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!ytdl.validateID(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Range"
  };

  try {
    const info = await ytdl.getInfo(videoId);
    const format = ytdl.chooseFormat(info.formats, { filter: "audioandvideo" });

    const contentLength = parseInt(format.contentLength || "0", 10);
    const mimeType = format.mimeType?.split(";")[0] || "video/mp4";
    const rangeHeader = req.headers.range;

    if (rangeHeader && contentLength) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : contentLength - 1;

      res.writeHead(206, {
        ...corsHeaders,
        "Content-Range": `bytes ${start}-${end}/${contentLength}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": mimeType,
        "Cache-Control": "no-cache"
      });

      ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
        format,
        range: { start, end }
      }).pipe(res);
    } else {
      const headers = {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Cache-Control": "no-cache"
      };
      if (contentLength) {
        headers["Content-Length"] = contentLength;
        headers["Accept-Ranges"] = "bytes";
      }
      res.writeHead(200, headers);
      ytdl(`https://www.youtube.com/watch?v=${videoId}`, { format }).pipe(res);
    }
  } catch (err) {
    console.error("YouTube proxy error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to proxy video", details: err.message });
    }
  }
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
  if (!room) {
    return { ok: false };
  }

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

  room.users = room.users.filter((user) => user.clientId !== leftClientId);
  room.suggestions = room.suggestions.filter((s) => s.clientId !== leftClientId);

  const onlineUsers = room.users;

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
        },
        settings: {
          allowParticipantControls: true,
          allowVideoSuggestions: true
        },
        suggestions: []
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
      messages: room.messages,
      settings: room.settings,
      suggestions: room.suggestions
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

  socket.on("update_room_settings", ({ roomId, settings }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false });
      return;
    }

    const s = rooms[roomId].settings;

    if (typeof settings?.allowParticipantControls === "boolean") {
      s.allowParticipantControls = settings.allowParticipantControls;
    }

    if (typeof settings?.allowVideoSuggestions === "boolean") {
      s.allowVideoSuggestions = settings.allowVideoSuggestions;
      if (!settings.allowVideoSuggestions) {
        rooms[roomId].suggestions = [];
      }
    }

    io.to(roomId).emit("room_settings", s);
    callback?.({ ok: true });
  });

  socket.on("transfer_host", ({ roomId, targetClientId }, callback) => {
    if (!rooms[roomId] || rooms[roomId].hostClientId !== socket.clientId) {
      callback?.({ ok: false });
      return;
    }

    const target = rooms[roomId].users.find((u) => u.clientId === targetClientId);
    if (!target) {
      callback?.({ ok: false });
      return;
    }

    rooms[roomId].hostClientId = targetClientId;
    io.to(roomId).emit("host_data", { hostClientId: targetClientId });

    const msg = createSystemMessage(
      `${socket.username} передал права хоста пользователю ${target.username}`
    );
    rooms[roomId].messages.push(msg);
    io.to(roomId).emit("receive_message", msg);

    callback?.({ ok: true });
  });

  socket.on("suggest_video", ({ roomId, videoUrl }, callback) => {
    if (!rooms[roomId]) {
      callback?.({ ok: false });
      return;
    }

    if (!rooms[roomId].settings.allowVideoSuggestions) {
      callback?.({ ok: false, error: "SUGGESTIONS_DISABLED" });
      return;
    }

    const cleanUrl = (videoUrl || "").trim();
    if (!cleanUrl) {
      callback?.({ ok: false, error: "EMPTY_URL" });
      return;
    }

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
      callback?.({ ok: false });
      return;
    }

    const idx = rooms[roomId].suggestions.findIndex((s) => s.id === suggestionId);
    if (idx === -1) {
      callback?.({ ok: false });
      return;
    }

    const sug = rooms[roomId].suggestions.splice(idx, 1)[0];

    if (approved) {
      rooms[roomId].videoState.videoUrl = sug.videoUrl;
      rooms[roomId].videoState.videoType = sug.videoType;
      rooms[roomId].videoState.currentTime = 0;
      rooms[roomId].videoState.isPlaying = false;
      rooms[roomId].videoState.lastActionAt = Date.now();
      io.to(roomId).emit("video_state", rooms[roomId].videoState);

      const msg = createSystemMessage(
        `${socket.username} принял видео от ${sug.username}`
      );
      rooms[roomId].messages.push(msg);
      io.to(roomId).emit("receive_message", msg);
    } else {
      const msg = createSystemMessage(
        `${socket.username} отклонил предложение от ${sug.username}`
      );
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

    const isRoomHost = rooms[roomId].hostClientId === socket.clientId;
    if (!isRoomHost && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" });
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

    const isRoomHost = rooms[roomId].hostClientId === socket.clientId;
    if (!isRoomHost && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" });
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

    const isRoomHost = rooms[roomId].hostClientId === socket.clientId;
    if (!isRoomHost && !rooms[roomId].settings.allowParticipantControls) {
      callback?.({ ok: false, error: "CONTROLS_DISABLED" });
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
