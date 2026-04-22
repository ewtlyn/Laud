import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import YouTubeSyncPlayer from "../components/YouTubeSyncPlayer";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";

const socket = io(SERVER_URL);

function detectVideoType(url) {
  if (!url) return "file";

  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }

  if (
    lowerUrl.includes("vk.com/video_ext.php") ||
    lowerUrl.includes("vkvideo.ru/video_ext.php")
  ) {
    return "vk";
  }

  return "file";
}

function RoomPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const savedName = localStorage.getItem("laudUsername");
  const username = (location.state?.username || savedName || "Гость").trim();

  const joinedRef = useRef(false);
  const htmlVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const lastProgressEmitRef = useRef(-1);

  const [users, setUsers] = useState([]);
  const [hostId, setHostId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState("file");
  const [youtubeSeekTime, setYoutubeSeekTime] = useState(0);
  const [inputUrl, setInputUrl] = useState("");
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [copyText, setCopyText] = useState("Скопировать ссылку");
  const [playing, setPlaying] = useState(false);

  const isHost = useMemo(() => socket.id === hostId, [hostId]);

  useEffect(() => {
    if (!username) {
      navigate("/");
      return;
    }

    if (joinedRef.current) return;
    joinedRef.current = true;

    socket.emit("join_room", { roomId, username });

    const onRoomUsers = (usersList) => {
      const uniqueUsers = [];
      const seenIds = new Set();

      for (const user of usersList) {
        if (!seenIds.has(user.id)) {
          seenIds.add(user.id);
          uniqueUsers.push(user);
        }
      }

      setUsers(uniqueUsers);
    };

    const onHostData = (data) => {
      setHostId(data.hostId || "");
    };

    const onVideoState = (state) => {
      console.log("SERVER VIDEO STATE", state);

      const nextType = state.videoType || "file";

      setVideoUrl(state.videoUrl || "");
      setVideoType(nextType);
      setPlaying(!!state.isPlaying);

      if (nextType === "file" && htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = state.currentTime || 0;

        if (state.isPlaying) {
          htmlVideoRef.current.play().catch(() => {});
        } else {
          htmlVideoRef.current.pause();
        }
      }

      if (nextType === "youtube") {
        setYoutubeSeekTime(state.currentTime || 0);
      }
    };

    const onPlayVideo = ({ currentTime }) => {
      if (videoType === "file" && htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = currentTime || 0;
        htmlVideoRef.current.play().catch(() => {});
      }

      if (videoType === "youtube") {
        setYoutubeSeekTime(currentTime || 0);
        setPlaying(true);
      }
    };

    const onPauseVideo = ({ currentTime }) => {
      if (videoType === "file" && htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = currentTime || 0;
        htmlVideoRef.current.pause();
      }

      if (videoType === "youtube") {
        setYoutubeSeekTime(currentTime || 0);
        setPlaying(false);
      }
    };

    const onSeekVideo = ({ currentTime }) => {
      if (videoType === "file" && htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = currentTime || 0;
      }

      if (videoType === "youtube") {
        setYoutubeSeekTime(currentTime || 0);
      }
    };

    const onReceiveMessage = (data) => {
      setMessages((prev) => {
        const exists = prev.some(
          (msg) =>
            msg.username === data.username &&
            msg.message === data.message &&
            msg.time === data.time
        );

        if (exists) return prev;
        return [...prev, data];
      });
    };

    socket.on("room_users", onRoomUsers);
    socket.on("host_data", onHostData);
    socket.on("video_state", onVideoState);
    socket.on("play_video", onPlayVideo);
    socket.on("pause_video", onPauseVideo);
    socket.on("seek_video", onSeekVideo);
    socket.on("receive_message", onReceiveMessage);

    return () => {
      socket.off("room_users", onRoomUsers);
      socket.off("host_data", onHostData);
      socket.off("video_state", onVideoState);
      socket.off("play_video", onPlayVideo);
      socket.off("pause_video", onPauseVideo);
      socket.off("seek_video", onSeekVideo);
      socket.off("receive_message", onReceiveMessage);

      socket.emit("leave_room", { roomId });
      joinedRef.current = false;
    };
}, [roomId, username, navigate]);
  useEffect(() => {
    console.log("VIDEO STATE CHANGED", { videoUrl, videoType });
  }, [videoUrl, videoType]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSetVideo = () => {
    if (!inputUrl.trim()) return;

    const cleanUrl = inputUrl.trim();
    const type = detectVideoType(cleanUrl);

    console.log("SET VIDEO CLICK", {
      cleanUrl,
      type,
      isHost,
      roomId,
      socketId: socket.id
    });

    setVideoUrl(cleanUrl);
    setVideoType(type);
    setPlaying(false);
    setYoutubeSeekTime(0);
    lastProgressEmitRef.current = -1;

    socket.emit("set_video", {
      roomId,
      videoUrl: cleanUrl,
      videoType: type
    });
  };

  const handleFilePlay = () => {
    if (!htmlVideoRef.current || !isHost) return;

    socket.emit("play_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleFilePause = () => {
    if (!htmlVideoRef.current || !isHost) return;

    socket.emit("pause_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleFileSeeked = () => {
    if (!htmlVideoRef.current || !isHost) return;

    socket.emit("seek_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleYoutubeReady = () => {
    console.log("YOUTUBE READY");
  };

  const handleYoutubePlay = (currentTime) => {
    if (!isHost) return;

    socket.emit("play_video", {
      roomId,
      currentTime
    });
  };

  const handleYoutubePause = (currentTime) => {
    if (!isHost) return;

    socket.emit("pause_video", {
      roomId,
      currentTime
    });
  };

  const handleYoutubeProgress = (currentTime) => {
    if (!isHost || !playing) return;

    const rounded = Math.floor(currentTime || 0);

    if (rounded !== lastProgressEmitRef.current && rounded % 3 === 0) {
      lastProgressEmitRef.current = rounded;

      socket.emit("seek_video", {
        roomId,
        currentTime: rounded
      });
    }
  };

  const sendMessage = () => {
    if (!message.trim()) return;

    socket.emit("send_message", {
      roomId,
      username,
      message: message.trim()
    });

    setMessage("");
  };

  const copyInviteLink = async () => {
    try {
      const link = `${window.location.origin}/room/${roomId}`;
      await navigator.clipboard.writeText(link);
      setCopyText("Скопировано");
      setTimeout(() => setCopyText("Скопировать ссылку"), 1500);
    } catch {
      alert("Не удалось скопировать ссылку");
    }
  };

  const renderPlayer = () => {
    if (!videoUrl) {
      return <div className="player-placeholder">Видео пока не выбрано</div>;
    }

    if (videoType === "youtube") {
      return (
        <YouTubeSyncPlayer
          videoUrl={videoUrl}
          playing={playing}
          seekToSeconds={youtubeSeekTime}
          isHost={isHost}
          onReady={handleYoutubeReady}
          onPlay={handleYoutubePlay}
          onPause={handleYoutubePause}
          onProgress={handleYoutubeProgress}
        />
      );
    }

    if (videoType === "vk") {
      return (
        <iframe
          src={videoUrl}
          width="100%"
          height="500"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          frameBorder="0"
          title="VK Video"
          className="player-iframe"
        />
      );
    }

    return (
      <video
        ref={htmlVideoRef}
        src={videoUrl}
        controls={isHost}
        onPlay={handleFilePlay}
        onPause={handleFilePause}
        onSeeked={handleFileSeeked}
        className="player-video"
      />
    );
  };

  return (
    <div className="room-page">
      <div className="room-header">
        <div>
          <h1 className="room-title">LAUD</h1>
          <p className="room-subtitle">
            Комната: {roomId} <span className="room-dot">•</span> Вы: {username}{" "}
            {isHost ? "• Хост" : ""}
          </p>
          <div className="hint-text">
            debug: host={String(isHost)} | type={videoType} | url={videoUrl || "EMPTY"}
          </div>
        </div>

        <div className="room-header-buttons">
          <button className="app-button app-button-dark" onClick={copyInviteLink}>
            {copyText}
          </button>
          <button className="app-button app-button-light" onClick={() => navigate("/")}>
            Выйти
          </button>
        </div>
      </div>

      <div className="room-layout">
        <div className="room-main">
          <div className="panel">
            <h2 className="panel-title">Плеер</h2>

            <div className="control-row">
              <input
                className="app-input"
                type="text"
                placeholder="mp4 / YouTube / VK embed"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={!isHost}
              />
              <button
                className="app-button app-button-light"
                onClick={handleSetVideo}
                disabled={!isHost}
              >
                Установить
              </button>
            </div>

            <div className="hint-text">
              Для VK вставляй embed-ссылку вида video_ext.php
            </div>

            {renderPlayer()}
          </div>
        </div>

        <div className="room-sidebar">
          <div className="panel">
            <h2 className="panel-title">Участники</h2>

            <div className="users-list">
              {users.map((user) => (
                <div key={user.id} className="user-item">
                  <span>{user.username}</span>
                  {user.id === hostId && <span className="host-badge">HOST</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Чат</h2>

            <div className="chat-box">
              {messages.map((msg, index) => {
                const isSystem = msg.username === "Система";

                return (
                  <div
                    key={index}
                    className={`message-item ${isSystem ? "message-system" : ""}`}
                  >
                    <div className="message-top">
                      <strong>{msg.username}</strong>
                      <span className="message-time">{msg.time}</span>
                    </div>
                    <div>{msg.message}</div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="control-row chat-row">
              <input
                className="app-input"
                type="text"
                placeholder="Введите сообщение"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
              />
              <button className="app-button app-button-light" onClick={sendMessage}>
                Отправить
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoomPage;