import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import YouTubeSyncPlayer from "../components/YouTubeSyncPlayer";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";

const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ["websocket", "polling"]
});

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

function getOrCreateClientId() {
  const existing = localStorage.getItem("laud_client_id");
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  localStorage.setItem("laud_client_id", created);
  return created;
}

function RoomPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const savedName = localStorage.getItem("laudUsername");
  const username = (location.state?.username || savedName || "Гость").trim();

  const clientIdRef = useRef(getOrCreateClientId());
  const htmlVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const suppressHtmlEventsRef = useRef(false);
  const leavingRef = useRef(false);
  const reconnectSyncTimeoutRef = useRef(null);
  const lastFileSyncSecondRef = useRef(-1);

  const [users, setUsers] = useState([]);
  const [hostClientId, setHostClientId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState("file");
  const [youtubeSeekTime, setYoutubeSeekTime] = useState(0);
  const [inputUrl, setInputUrl] = useState("");
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [isConnected, setIsConnected] = useState(socket.connected);

  const isHost = useMemo(() => {
    return hostClientId === clientIdRef.current;
  }, [hostClientId]);

  const getExpectedTime = (state) => {
    const baseTime = Number(state?.currentTime) || 0;
    const lastActionAt =
      Number(state?.lastActionAt) ||
      Number(state?.emittedAt) ||
      Date.now();
    const isPlayingNow = Boolean(state?.isPlaying);

    if (!isPlayingNow) return baseTime;

    const elapsed = Math.max(0, (Date.now() - lastActionAt) / 1000);
    return baseTime + elapsed;
  };

  const applyRemoteVideoState = (state) => {
    if (!state) return;

    const nextType = state.videoType || "file";
    const expectedTime = getExpectedTime(state);

    setVideoUrl(state.videoUrl || "");
    setVideoType(nextType);
    setPlaying(Boolean(state.isPlaying));
    setPlayerError("");

    if (nextType === "youtube") {
      setYoutubeSeekTime(expectedTime);
      return;
    }

    if (nextType === "file" && htmlVideoRef.current) {
      suppressHtmlEventsRef.current = true;

      try {
        const current = Number(htmlVideoRef.current.currentTime) || 0;
        const diff = Math.abs(current - expectedTime);

        if (diff > 1.5) {
          htmlVideoRef.current.currentTime = expectedTime;
        }

        if (state.isPlaying) {
          htmlVideoRef.current.play().catch(() => {});
        } else {
          htmlVideoRef.current.pause();
        }
      } catch {}

      setTimeout(() => {
        suppressHtmlEventsRef.current = false;
      }, 250);
    }
  };

  const requestFreshRoomState = () => {
    socket.emit("get_room_state", { roomId }, (response) => {
      if (!response?.ok) return;

      if (response.users) setUsers(response.users);
      if (response.hostClientId) setHostClientId(response.hostClientId);
      if (response.messages) setMessages(response.messages);
      if (response.videoState) applyRemoteVideoState(response.videoState);
    });
  };

  useEffect(() => {
    if (!username) {
      navigate("/");
      return;
    }

    const joinRoom = () => {
      socket.emit(
        "join_room",
        {
          roomId,
          username,
          clientId: clientIdRef.current
        },
        (response) => {
          if (!response?.ok) {
            console.error("join_room failed", response);
          }
        }
      );
    };

    const onConnect = () => {
      setIsConnected(true);
      joinRoom();

      clearTimeout(reconnectSyncTimeoutRef.current);
      reconnectSyncTimeoutRef.current = setTimeout(() => {
        requestFreshRoomState();
      }, 350);
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onRoomSnapshot = ({ users, hostClientId, videoState, messages }) => {
      setUsers(users || []);
      setHostClientId(hostClientId || "");
      setMessages(messages || []);

      if (videoState) {
        applyRemoteVideoState(videoState);
      }
    };

    const onRoomUsers = (usersList) => {
      setUsers(usersList || []);
    };

    const onHostData = (data) => {
      setHostClientId(data.hostClientId || "");
    };

    const onVideoState = (state) => {
      applyRemoteVideoState(state);
    };

    const onPlayVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl,
        videoType,
        currentTime,
        isPlaying: true,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onPauseVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl,
        videoType,
        currentTime,
        isPlaying: false,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onSeekVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl,
        videoType,
        currentTime,
        isPlaying: playing,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onSyncProgress = ({ currentTime, isPlaying, lastActionAt, emittedAt }) => {
      if (isHost) return;

      const next = getExpectedTime({
        currentTime,
        isPlaying,
        lastActionAt: lastActionAt || emittedAt
      });

      if (videoType === "youtube") {
        setPlaying(Boolean(isPlaying));
        setYoutubeSeekTime((prev) => {
          return Math.abs(prev - next) > 1.5 ? next : prev;
        });
        return;
      }

      if (videoType === "file" && htmlVideoRef.current) {
        const current = Number(htmlVideoRef.current.currentTime) || 0;
        const diff = Math.abs(current - next);

        suppressHtmlEventsRef.current = true;

        try {
          if (diff > 1.5) {
            htmlVideoRef.current.currentTime = next;
          }

          if (isPlaying) {
            htmlVideoRef.current.play().catch(() => {});
          } else {
            htmlVideoRef.current.pause();
          }
        } catch {}

        setPlaying(Boolean(isPlaying));

        setTimeout(() => {
          suppressHtmlEventsRef.current = false;
        }, 250);
      }
    };

    const onReceiveMessage = (data) => {
      setMessages((prev) => {
        if (prev.some((msg) => msg.id === data.id)) return prev;
        return [...prev, data];
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_snapshot", onRoomSnapshot);
    socket.on("room_users", onRoomUsers);
    socket.on("host_data", onHostData);
    socket.on("video_state", onVideoState);
    socket.on("play_video", onPlayVideo);
    socket.on("pause_video", onPauseVideo);
    socket.on("seek_video", onSeekVideo);
    socket.on("sync_progress", onSyncProgress);
    socket.on("receive_message", onReceiveMessage);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_snapshot", onRoomSnapshot);
      socket.off("room_users", onRoomUsers);
      socket.off("host_data", onHostData);
      socket.off("video_state", onVideoState);
      socket.off("play_video", onPlayVideo);
      socket.off("pause_video", onPauseVideo);
      socket.off("seek_video", onSeekVideo);
      socket.off("sync_progress", onSyncProgress);
      socket.off("receive_message", onReceiveMessage);

      clearTimeout(reconnectSyncTimeoutRef.current);

      if (leavingRef.current) {
        socket.emit("leave_room");
      }
    };
  }, [roomId, username, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSetVideo = () => {
    if (!isHost) return;
    if (!inputUrl.trim()) return;

    const cleanUrl = inputUrl.trim();
    const type = detectVideoType(cleanUrl);

    setVideoUrl(cleanUrl);
    setVideoType(type);
    setPlaying(false);
    setYoutubeSeekTime(0);
    setPlayerError("");
    lastFileSyncSecondRef.current = -1;

    socket.emit(
      "set_video",
      {
        roomId,
        videoUrl: cleanUrl,
        videoType: type
      },
      (response) => {
        if (!response?.ok) {
          console.error("set_video failed", response);
          alert("Не удалось установить видео");
        }
      }
    );
  };

  const handleFilePlay = () => {
    if (!isHost || suppressHtmlEventsRef.current || !htmlVideoRef.current) return;

    socket.emit("play_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleFilePause = () => {
    if (!isHost || suppressHtmlEventsRef.current || !htmlVideoRef.current) return;

    socket.emit("pause_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleFileSeeked = () => {
    if (!isHost || suppressHtmlEventsRef.current || !htmlVideoRef.current) return;

    socket.emit("seek_video", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime
    });
  };

  const handleFileTimeUpdate = () => {
    if (!isHost || !htmlVideoRef.current) return;

    const current = Number(htmlVideoRef.current.currentTime) || 0;
    const rounded = Math.floor(current);

    if (rounded === lastFileSyncSecondRef.current) return;
    lastFileSyncSecondRef.current = rounded;

    socket.emit("sync_progress", {
      roomId,
      currentTime: current,
      isPlaying: !htmlVideoRef.current.paused
    });
  };

  const handleYoutubeReady = () => {};

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
    if (!isHost) return;

    socket.emit("sync_progress", {
      roomId,
      currentTime,
      isPlaying: true
    });
  };

  const sendMessage = () => {
    if (!message.trim()) return;

    const text = message.trim();
    const clientMessageId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    socket.emit(
      "send_message",
      {
        roomId,
        username,
        message: text,
        clientMessageId
      },
      (response) => {
        if (!response?.ok) {
          console.error("message failed", response);
          alert("Сообщение не отправилось");
        }
      }
    );

    setMessage("");
  };

  const handleLeave = () => {
    leavingRef.current = true;
    navigate("/");
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
          onError={(text) => setPlayerError(text)}
        />
      );
    }

    if (videoType === "vk") {
      return (
        <div className="vk-player-wrap">
          <iframe
            src={videoUrl}
            width="100%"
            height="500"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            frameBorder="0"
            title="VK Video"
            className="player-iframe"
            onError={() =>
              setPlayerError(
                "Это видео запрещено для встраивания или временно недоступно"
              )
            }
          />
          {playerError && <div className="player-error-inline">{playerError}</div>}
        </div>
      );
    }

    return (
      <video
        ref={htmlVideoRef}
        src={videoUrl}
        controls
        onPlay={handleFilePlay}
        onPause={handleFilePause}
        onSeeked={handleFileSeeked}
        onTimeUpdate={handleFileTimeUpdate}
        onWaiting={() => {
          if (!isHost) requestFreshRoomState();
        }}
        onStalled={() => {
          if (!isHost) requestFreshRoomState();
        }}
        onPlaying={() => {
          if (!isHost) requestFreshRoomState();
        }}
        className="player-video"
      />
    );
  };

  return (
    <div className="room-page room-shell">
      {sidebarOpen && (
        <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="room-topbar">
        <div className="room-topbar-left">
          <div className="brand-row">
            <h1 className="room-brand">LAUD</h1>

            <button
              className="icon-button mobile-drawer-toggle"
              onClick={() => setSidebarOpen(true)}
              type="button"
              aria-label="Открыть участников"
            >
              ☰
            </button>
          </div>

          <div className="room-meta">
            <span className="room-meta-item">Комната: {roomId}</span>
            <span className="room-meta-sep">•</span>
            <span className="room-meta-item">Вы: {username}</span>
            {isHost && (
              <>
                <span className="room-meta-sep">•</span>
                <span className="room-meta-item">Хост</span>
              </>
            )}
          </div>

          <div className={`room-status ${isConnected ? "online" : "offline"}`}>
            <span className="status-dot" />
            {isConnected ? "Онлайн" : "Переподключение..."}
          </div>
        </div>

        <div className="room-topbar-actions">
          <button className="ghost-button" onClick={handleLeave}>
            Выйти
          </button>
        </div>
      </div>

      <div className="room-grid">
        <main className="main-column">
          <section className="card player-card">
            <div className="section-header">
              <h2 className="section-title">Плеер</h2>
            </div>

            <div className="video-toolbar">
              <input
                className="app-input compact-input"
                type="text"
                placeholder="Вставь ссылку на видео"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                disabled={!isHost}
              />
              <button
                className="primary-button"
                onClick={handleSetVideo}
                disabled={!isHost}
              >
                Установить
              </button>
            </div>

            <div className="micro-hint">
              YouTube, mp4 или VK embed-ссылка вида video_ext.php
            </div>

            <div className="player-stage">{renderPlayer()}</div>
          </section>

          <section className="card chat-card">
            <div className="section-header">
              <h2 className="section-title">Чат</h2>
            </div>

            <div className="chat-box modern-chat-box">
              {messages.map((msg) => {
                const isSystem = msg.username === "Система" || msg.system;

                return (
                  <div
                    key={msg.id}
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

            <div className="chat-input-row">
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
              <button className="secondary-button send-button" onClick={sendMessage}>
                Отправить
              </button>
            </div>
          </section>
        </main>

        <aside
          className={`side-column participants-drawer ${
            sidebarOpen ? "mobile-open" : "mobile-hidden"
          }`}
        >
          <section className="card participants-card">
            <div className="section-header">
              <h2 className="section-title">Участники</h2>
              <button
                className="icon-button mobile-close-button"
                onClick={() => setSidebarOpen(false)}
                type="button"
                aria-label="Закрыть участников"
              >
                ✕
              </button>
            </div>

            <div className="users-list">
              {users.map((user) => (
                <div key={user.clientId || user.id} className="user-item">
                  <span>
                    {user.username} {!user.isOnline ? "• offline" : ""}
                  </span>
                  {user.clientId === hostClientId && (
                    <span className="host-badge">HOST</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default RoomPage;