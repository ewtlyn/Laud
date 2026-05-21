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

function normalizeVkUrl(url) {
  if (!url) return url;
  if (url.includes("video_ext.php")) return url;

  const match = url.match(/video(-?\d+)_(\d+)/);
  if (match) {
    return `https://vk.com/video_ext.php?oid=${match[1]}&id=${match[2]}`;
  }

  return url;
}

function detectVideoType(url) {
  if (!url) return "file";

  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }

  if (
    lowerUrl.includes("vk.com/video_ext.php") ||
    lowerUrl.includes("vkvideo.ru/video_ext.php") ||
    lowerUrl.includes("vk.com/video") ||
    lowerUrl.includes("vkvideo.ru/video")
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
  const messagesEndRef2 = useRef(null);
  const reconnectSyncTimeoutRef = useRef(null);
  const suppressHtmlEventsRef = useRef(false);
  const leavingRef = useRef(false);
  const lastFileSyncSecondRef = useRef(-1);
  const videoUrlRef = useRef("");
  const videoTypeRef = useRef("file");
  const playingRef = useRef(false);
  const youtubeSeekRef = useRef(0);
  const lastRemoteSyncRef = useRef(0);

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
  const [replyTo, setReplyTo] = useState(null);
  const [useYoutubeProxy, setUseYoutubeProxy] = useState(
    () => localStorage.getItem("laud_yt_proxy") === "1"
  );

  const [roomSettings, setRoomSettings] = useState({
    allowParticipantControls: true,
    allowVideoSuggestions: true
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState([]);
  const [suggestUrl, setSuggestUrl] = useState("");
  const [suggestionSent, setSuggestionSent] = useState(false);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    videoTypeRef.current = videoType;
  }, [videoType]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    youtubeSeekRef.current = youtubeSeekTime;
  }, [youtubeSeekTime]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 640) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const apply = (mobile) => {
      document.documentElement.style.height = mobile ? "100%" : "";
      document.body.style.height = mobile ? "100%" : "";
      document.body.style.overflow = mobile ? "hidden" : "";
    };
    apply(mq.matches);
    const handler = (e) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
      document.documentElement.style.height = "";
      document.body.style.height = "";
      document.body.style.overflow = "";
    };
  }, []);

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
      const currentSeek = youtubeSeekRef.current || 0;
      const diff = Math.abs(currentSeek - expectedTime);

      if (diff > 2) {
        setYoutubeSeekTime(expectedTime);
      }
      return;
    }

    if (nextType === "file" && htmlVideoRef.current) {
      suppressHtmlEventsRef.current = true;

      try {
        const current = Number(htmlVideoRef.current.currentTime) || 0;
        const diff = Math.abs(current - expectedTime);

        if (diff > 2) {
          htmlVideoRef.current.currentTime = expectedTime;
        }

        if (state.isPlaying && htmlVideoRef.current.paused) {
          htmlVideoRef.current.play().catch(() => {});
        } else if (!state.isPlaying && !htmlVideoRef.current.paused) {
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
      if (response.settings) setRoomSettings(response.settings);
      if (response.suggestions) setPendingSuggestions(response.suggestions);
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
        () => {}
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

    const onRoomSnapshot = ({ users, hostClientId, videoState, messages, settings, suggestions }) => {
      setUsers(users || []);
      setHostClientId(hostClientId || "");
      setMessages(messages || []);
      if (settings) setRoomSettings(settings);
      if (suggestions) setPendingSuggestions(suggestions);

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

    const onRoomSettings = (settings) => {
      setRoomSettings(settings || { allowParticipantControls: true, allowVideoSuggestions: true });
      if (!settings?.allowVideoSuggestions) {
        setPendingSuggestions([]);
      }
    };

    const onNewSuggestion = (suggestion) => {
      setPendingSuggestions((prev) => [...prev, suggestion]);
    };

    const onSuggestionResponse = () => {
      setSuggestionSent(false);
    };

    const onPlayVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl: videoUrlRef.current,
        videoType: videoTypeRef.current,
        currentTime,
        isPlaying: true,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onPauseVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl: videoUrlRef.current,
        videoType: videoTypeRef.current,
        currentTime,
        isPlaying: false,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onSeekVideo = ({ currentTime, lastActionAt, emittedAt }) => {
      applyRemoteVideoState({
        videoUrl: videoUrlRef.current,
        videoType: videoTypeRef.current,
        currentTime,
        isPlaying: playingRef.current,
        lastActionAt: lastActionAt || emittedAt
      });
    };

    const onSyncProgress = ({
      currentTime,
      isPlaying,
      lastActionAt,
      emittedAt
    }) => {
      if (isHost) return;

      const now = Date.now();

      if (now - lastRemoteSyncRef.current < 1200) return;
      lastRemoteSyncRef.current = now;

      const next = getExpectedTime({
        currentTime,
        isPlaying,
        lastActionAt: lastActionAt || emittedAt
      });

      if (videoTypeRef.current === "youtube") {
        setPlaying(Boolean(isPlaying));

        const localSeek = youtubeSeekRef.current || 0;
        const diff = Math.abs(localSeek - next);

        if (diff > 2) {
          setYoutubeSeekTime(next);
        }
        return;
      }

      if (videoTypeRef.current === "file" && htmlVideoRef.current) {
        const current = Number(htmlVideoRef.current.currentTime) || 0;
        const diff = Math.abs(current - next);

        suppressHtmlEventsRef.current = true;

        try {
          if (diff > 2) {
            htmlVideoRef.current.currentTime = next;
          }

          if (isPlaying && htmlVideoRef.current.paused) {
            htmlVideoRef.current.play().catch(() => {});
          } else if (!isPlaying && !htmlVideoRef.current.paused) {
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
    socket.on("room_settings", onRoomSettings);
    socket.on("new_suggestion", onNewSuggestion);
    socket.on("suggestion_response", onSuggestionResponse);
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
      socket.off("room_settings", onRoomSettings);
      socket.off("new_suggestion", onNewSuggestion);
      socket.off("suggestion_response", onSuggestionResponse);
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
  }, [roomId, username, navigate, isHost]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    messagesEndRef2.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSetVideo = () => {
    if (!isHost) return;
    if (!inputUrl.trim()) return;

    const cleanUrl = normalizeVkUrl(inputUrl.trim());
    const type = detectVideoType(cleanUrl);

    setVideoUrl(cleanUrl);
    setVideoType(type);
    setPlaying(false);
    setYoutubeSeekTime(0);
    setPlayerError("");
    lastFileSyncSecondRef.current = -1;
    youtubeSeekRef.current = 0;
    lastRemoteSyncRef.current = 0;

    socket.emit("set_video", {
      roomId,
      videoUrl: cleanUrl,
      videoType: type
    });
  };

  const handleUpdateSettings = (patch) => {
    const next = { ...roomSettings, ...patch };
    setRoomSettings(next);
    socket.emit("update_room_settings", { roomId, settings: next });
  };

  const handleTransferHost = (targetClientId) => {
    socket.emit("transfer_host", { roomId, targetClientId }, (res) => {
      if (res?.ok) {
        setSettingsOpen(false);
      }
    });
  };

  const handleSuggestVideo = () => {
    if (!suggestUrl.trim()) return;
    const cleanUrl = normalizeVkUrl(suggestUrl.trim());
    socket.emit("suggest_video", { roomId, videoUrl: cleanUrl }, (res) => {
      if (res?.ok) {
        setSuggestionSent(true);
        setSuggestUrl("");
      }
    });
  };

  const handleRespondSuggestion = (suggestionId, approved) => {
    socket.emit("respond_suggestion", { roomId, suggestionId, approved }, (res) => {
      if (res?.ok) {
        setPendingSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
        if (approved) {
          setYoutubeSeekTime(0);
          youtubeSeekRef.current = 0;
          lastRemoteSyncRef.current = 0;
        }
      }
    });
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

  const handleYoutubeProgress = (currentTime, isPlaying) => {
    if (!isHost) return;

    socket.emit("sync_progress", {
      roomId,
      currentTime,
      isPlaying: isPlaying ?? playingRef.current
    });
  };

  const sendMessage = () => {
    if (!message.trim()) return;

    const text = message.trim();
    const clientMessageId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    socket.emit("send_message", {
      roomId,
      username,
      message: text,
      clientMessageId
    });

    setMessage("");
    setReplyTo(null);
  };

  const handleLeave = () => {
    leavingRef.current = true;
    navigate("/");
  };

  const handleReply = (msg) => {
    if (msg.username === "Система" || msg.system) return;
    setReplyTo(msg);
  };

  const renderPlayer = () => {
    const canControl = isHost || roomSettings.allowParticipantControls;

    const controlsOverlay = !canControl ? (
      <div className="player-controls-overlay">
        <span className="player-controls-overlay-hint">Управление заблокировано</span>
      </div>
    ) : null;

    if (!videoUrl) {
      return <div className="player-placeholder">Видео пока не выбрано</div>;
    }

    if (videoType === "youtube") {
      return (
        <div className="player-youtube-wrap">
          <YouTubeSyncPlayer
            videoUrl={videoUrl}
            playing={playing}
            seekToSeconds={youtubeSeekTime}
            isHost={isHost}
            onPlay={handleYoutubePlay}
            onPause={handleYoutubePause}
            onProgress={handleYoutubeProgress}
            onError={(text) => setPlayerError(text)}
          />
          {controlsOverlay}
        </div>
      );
    }

    if (videoType === "vk") {
      return (
        <div className="vk-player-wrap">
          <iframe
            src={videoUrl}
            title="VK Video"
            className="player-iframe vk-frame"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            frameBorder="0"
          />
          {controlsOverlay}
          {playerError && <div className="player-error-inline">{playerError}</div>}
        </div>
      );
    }

    const revertToHostState = () => {
      suppressHtmlEventsRef.current = true;
      const vid = htmlVideoRef.current;
      if (!vid) return;
      if (playingRef.current && vid.paused) vid.play().catch(() => {});
      if (!playingRef.current && !vid.paused) vid.pause();
      setTimeout(() => { suppressHtmlEventsRef.current = false; }, 300);
    };

    return (
      <div className="player-wrap">
        <video
          ref={htmlVideoRef}
          src={videoUrl}
          controls
          onPlay={() => isHost ? handleFilePlay() : revertToHostState()}
          onPause={() => isHost ? handleFilePause() : revertToHostState()}
          onSeeked={() => {
            if (isHost) { handleFileSeeked(); }
            else { requestFreshRoomState(); }
          }}
          onTimeUpdate={handleFileTimeUpdate}
          onWaiting={() => { if (!isHost) requestFreshRoomState(); }}
          onStalled={() => { if (!isHost) requestFreshRoomState(); }}
          className="player-video"
        />
        {controlsOverlay}
      </div>
    );
  };

  const renderSettings = () => {
    if (!settingsOpen) return null;

    const otherUsers = users.filter((u) => u.clientId !== clientIdRef.current);

    return (
      <>
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
        <div className="settings-modal">
          <div className="settings-modal-header">
            <h2 className="settings-modal-title">Настройки комнаты</h2>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="settings-section">
            <div className="settings-section-label">Передать права хоста</div>
            {otherUsers.length === 0 ? (
              <p className="settings-empty-hint">Нет других участников в комнате</p>
            ) : (
              <div className="settings-users-list">
                {otherUsers.map((u) => (
                  <div key={u.clientId} className="settings-user-row">
                    <div className="user-avatar settings-user-avatar">
                      {(u.username || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <span className="settings-user-name">{u.username}</span>
                    <button
                      className="secondary-button settings-transfer-btn"
                      onClick={() => handleTransferHost(u.clientId)}
                    >
                      Передать
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-divider" />

          <div className="settings-section">
            <label className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Управление участниками</span>
                <span className="settings-toggle-desc">
                  Разрешить участникам ставить паузу и перематывать
                </span>
              </div>
              <div
                className={`toggle-track ${roomSettings.allowParticipantControls ? "toggle-on" : ""}`}
                onClick={() => handleUpdateSettings({ allowParticipantControls: !roomSettings.allowParticipantControls })}
                role="switch"
                aria-checked={roomSettings.allowParticipantControls}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") handleUpdateSettings({ allowParticipantControls: !roomSettings.allowParticipantControls }); }}
              >
                <div className="toggle-thumb" />
              </div>
            </label>
          </div>

          <div className="settings-divider" />

          <div className="settings-section">
            <label className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Предложения видео</span>
                <span className="settings-toggle-desc">
                  Участники могут предлагать видео на одобрение хоста
                </span>
              </div>
              <div
                className={`toggle-track ${roomSettings.allowVideoSuggestions ? "toggle-on" : ""}`}
                onClick={() => handleUpdateSettings({ allowVideoSuggestions: !roomSettings.allowVideoSuggestions })}
                role="switch"
                aria-checked={roomSettings.allowVideoSuggestions}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") handleUpdateSettings({ allowVideoSuggestions: !roomSettings.allowVideoSuggestions }); }}
              >
                <div className="toggle-thumb" />
              </div>
            </label>
          </div>
        </div>
      </>
    );
  };

  const renderChat = (endRef = messagesEndRef) => (
    <section className="card chat-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">Чат</h2>
          <p className="section-subtitle">Общение в реальном времени</p>
        </div>
      </div>

      {replyTo && (
        <div className="reply-preview">
          <div className="reply-preview-top">
            <strong>Reply to {replyTo.username}</strong>
            <button
              type="button"
              className="reply-clear-button"
              onClick={() => setReplyTo(null)}
            >
              ✕
            </button>
          </div>
          <div className="reply-preview-text">{replyTo.message}</div>
        </div>
      )}

      <div className="chat-box modern-chat-box">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">Пока тихо</div>
            <div className="empty-state-text">
              Отправь первое сообщение в комнату
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isSystem = msg.username === "Система" || msg.system;

          return (
            <div
              key={msg.id || `${msg.username}-${msg.time}-${msg.message}`}
              className={`message-item ${isSystem ? "message-system" : ""}`}
              onClick={() => handleReply(msg)}
            >
              <div className="message-top">
                <strong>{msg.username}</strong>
                <span className="message-time">{msg.time}</span>
              </div>
              <div className="message-body">{msg.message}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="app-input chat-input"
          type="text"
          placeholder={replyTo ? `Reply to ${replyTo.username}` : "Введите сообщение"}
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
  );

  const renderParticipants = (mobileDrawer = false) => (
    <section
      className={`card participants-card ${
        mobileDrawer ? "participants-drawer mobile-open" : ""
      }`}
    >
      <div className="section-header">
        <div>
          <h2 className="section-title">Участники</h2>
          <p className="section-subtitle">{users.length} в комнате</p>
        </div>

        {mobileDrawer && (
          <button
            className="icon-button mobile-close-button"
            onClick={() => setSidebarOpen(false)}
            type="button"
          >
            ✕
          </button>
        )}
      </div>

      <div className="users-list">
        {users.map((user) => (
          <div key={user.clientId || user.id} className="user-item">
            <div className="user-main">
              <div className="user-avatar">
                {(user.username || "?").slice(0, 1).toUpperCase()}
              </div>

              <div className="user-meta">
                <span className="user-name">{user.username}</span>
                <span className="user-status">online</span>
              </div>
            </div>

            {user.clientId === hostClientId && (
              <span className="host-badge">HOST</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="room-page room-shell">
      {renderSettings()}

      {sidebarOpen && (
        <>
          <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} />
          {renderParticipants(true)}
        </>
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
          {isHost && (
            <button
              className="ghost-button settings-button"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              Настройки
            </button>
          )}
          <button className="ghost-button leave-button" onClick={handleLeave}>
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

            {isHost && pendingSuggestions.length > 0 && (
              <div className="suggestions-panel">
                <div className="suggestions-panel-title">
                  Предложения видео ({pendingSuggestions.length})
                </div>
                {pendingSuggestions.map((sug) => (
                  <div key={sug.id} className="suggestion-item">
                    <div className="suggestion-info">
                      <span className="suggestion-from">{sug.username}</span>
                      <span className="suggestion-url">{sug.videoUrl}</span>
                    </div>
                    <div className="suggestion-actions">
                      <button
                        className="primary-button suggestion-btn"
                        onClick={() => handleRespondSuggestion(sug.id, true)}
                      >
                        Принять
                      </button>
                      <button
                        className="secondary-button suggestion-btn"
                        onClick={() => handleRespondSuggestion(sug.id, false)}
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isHost && (
              <div className="video-toolbar">
                <input
                  className="app-input compact-input"
                  type="text"
                  placeholder="YouTube, mp4 или ссылка на видео VK"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                />

                <button
                  className="primary-button"
                  onClick={handleSetVideo}
                >
                  Установить
                </button>
              </div>
            )}

            <div className="micro-hint">
              {isHost ? "Вставьте ссылку и нажмите Установить." : "Хост управляет видео. Вы синхронизированы."}
              {" "}
              <label style={{ cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={useYoutubeProxy}
                  onChange={(e) => {
                    setUseYoutubeProxy(e.target.checked);
                    localStorage.setItem("laud_yt_proxy", e.target.checked ? "1" : "0");
                  }}
                  style={{ marginRight: 4 }}
                />
                YouTube через прокси (для РФ)
              </label>
            </div>

            {!isHost && roomSettings.allowVideoSuggestions && (
              <div className="suggest-row">
                {suggestionSent ? (
                  <div className="suggest-sent">
                    Предложение отправлено — ожидайте одобрения хоста
                  </div>
                ) : (
                  <>
                    <input
                      className="app-input compact-input"
                      type="text"
                      placeholder="Предложить видео хосту"
                      value={suggestUrl}
                      onChange={(e) => setSuggestUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSuggestVideo(); }}
                    />
                    <button className="secondary-button" onClick={handleSuggestVideo}>
                      Предложить
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="player-stage">{renderPlayer()}</div>
          </section>

          <div className="mobile-chat-only">
            {renderChat(messagesEndRef)}
          </div>
        </main>

        <aside className="side-column">
          {renderParticipants(false)}
          {renderChat(messagesEndRef2)}
        </aside>
      </div>
    </div>
  );
}

export default RoomPage;
