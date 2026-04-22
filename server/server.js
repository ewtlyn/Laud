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

function createSystemMessage(text) {
  return {
    username: "Система",
    message: text,
    time: new Date().toLocaleTimeString()
  };
}

function removeUserFromRoom(socket) {
  const roomId = socket.roomId;
  if (!roomId || !rooms[roomId]) return;

  const room = rooms[roomId];
  const leftUserName = socket.username || "Гость";

  room.users = room.users.filter((user) => user.id !== socket.id);

  if (room.users.length > 0 && room.hostId === socket.id) {
    room.hostId = room.users[0].id;

    io.to(roomId).emit("host_data", {
      hostId: room.hostId
    });

    io.to(roomId).emit(
      "receive_message",
      createSystemMessage(`${room.users[0].username} теперь хост комнаты`)
    );
  }

  io.to(roomId).emit("room_users", room.users);

  if (room.users.length > 0) {
    io.to(roomId).emit(
      "receive_message",
      createSystemMessage(`${leftUserName} покинул комнату`)
    );
  }

  if (room.users.length === 0) {
    delete rooms[roomId];
  }
}

io.on("connection", (socket) => {
  console.log("Пользователь подключился:", socket.id);

  socket.on("join_room", ({ roomId, username }) => {
    if (!roomId) return;

    const safeUsername = (username || "Гость").trim() || "Гость";

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostId: socket.id,
        users: [],
        videoState: {
          isPlaying: false,
          currentTime: 0,
          videoUrl: "",
          videoType: "file"
        }
      };
    }

    const room = rooms[roomId];

    const user = {
      id: socket.id,
      username: safeUsername
    };

    room.users = room.users.filter((existingUser) => existingUser.id !== socket.id);
    room.users.push(user);

    socket.roomId = roomId;
    socket.username = safeUsername;

    io.to(roomId).emit("room_users", room.users);
    io.to(roomId).emit("host_data", {
      hostId: room.hostId
    });

    socket.emit("video_state", room.videoState);

    io.to(roomId).emit(
      "receive_message",
      createSystemMessage(`${safeUsername} присоединился к комнате`)
    );

    console.log(`${safeUsername} вошел в комнату ${roomId}`);
  });

  socket.on("leave_room", () => {
    removeUserFromRoom(socket);
  });

  socket.on("set_video", ({ roomId, videoUrl, videoType }) => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].hostId !== socket.id) return;

    rooms[roomId].videoState.videoUrl = videoUrl || "";
    rooms[roomId].videoState.videoType = videoType || "file";
    rooms[roomId].videoState.currentTime = 0;
    rooms[roomId].videoState.isPlaying = false;

    io.to(roomId).emit("video_state", rooms[roomId].videoState);

    io.to(roomId).emit(
      "receive_message",
      createSystemMessage(`${socket.username} установил новое видео`)
    );
  });

  // Любой участник может запустить видео
  socket.on("play_video", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].videoState.isPlaying = true;
    rooms[roomId].videoState.currentTime = currentTime || 0;

    io.to(roomId).emit("play_video", {
      currentTime: currentTime || 0
    });
  });

  // Любой участник может поставить на паузу
  socket.on("pause_video", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].videoState.isPlaying = false;
    rooms[roomId].videoState.currentTime = currentTime || 0;

    io.to(roomId).emit("pause_video", {
      currentTime: currentTime || 0
    });
  });

  // Любой участник может перематывать
  socket.on("seek_video", ({ roomId, currentTime }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].videoState.currentTime = currentTime || 0;

    io.to(roomId).emit("seek_video", {
      currentTime: currentTime || 0
    });
  });

  socket.on("send_message", ({ roomId, username, message }) => {
    if (!rooms[roomId]) return;
    if (!message || !message.trim()) return;

    io.to(roomId).emit("receive_message", {
      username: (username || "Гость").trim() || "Гость",
      message: message.trim(),
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("disconnect", () => {
    removeUserFromRoom(socket);
    console.log("Пользователь отключился:", socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`LAUD server запущен на порту ${PORT}`);
});