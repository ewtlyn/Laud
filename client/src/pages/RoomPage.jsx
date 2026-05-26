import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import YouTubeSyncPlayer from "../components/YouTubeSyncPlayer";
import VKSyncPlayer from "../components/VKSyncPlayer";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5001";

const socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ["websocket", "polling"],
});

// ─── helpers ────────────────────────────────────────────────────────────────

function resizeImageForChat(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function normalizeVkUrl(url) {
  if (!url) return url;
  if (url.includes("video_ext.php")) return url;
  const m = url.match(/video(-?\d+)_(\d+)/);
  if (m) return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}`;
  return url;
}

function detectVideoType(url) {
  if (!url) return "file";
  const l = url.toLowerCase();
  if (l.includes("youtube.com") || l.includes("youtu.be")) return "youtube";
  if (
    l.includes("vk.com/video_ext.php") ||
    l.includes("vkvideo.ru/video_ext.php") ||
    l.includes("vk.com/video") ||
    l.includes("vkvideo.ru/video")
  ) return "vk";
  return "file";
}

function getOrCreateClientId() {
  const k = "laud_client_id";
  let id = localStorage.getItem(k);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, id);
  }
  return id;
}

function getExpectedTime(state) {
  const base = Number(state?.currentTime) || 0;
  const lastAt = Number(state?.lastActionAt) || Date.now();
  if (!state?.isPlaying) return base;
  return base + Math.max(0, (Date.now() - lastAt) / 1000);
}

// ─── component ──────────────────────────────────────────────────────────────

export default function RoomPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const savedName = localStorage.getItem("laudUsername");
  const username = (location.state?.username || savedName || "Гость").trim();

  const clientIdRef = useRef(getOrCreateClientId());
  const htmlVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const sideChatMessagesRef = useRef(null);
  const photoInputRef = useRef(null);
  const atBottomRef = useRef(true);
  const suppressHtmlRef = useRef(false);
  const leavingRef = useRef(false);
  const lastFileSyncRef = useRef(-1);
  const videoUrlRef = useRef("");
  const videoTypeRef = useRef("file");
  const playingRef = useRef(false);
  const ytSeekRef = useRef(0);
  const lastSyncRef = useRef(0);
  const lastVideoStateRef = useRef(null);

  const [users, setUsers] = useState([]);
  const [hostClientId, setHostClientId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState("file");
  const [ytSeekTime, setYtSeekTime] = useState(0);
  const [inputUrl, setInputUrl] = useState("");
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [replyTo, setReplyTo] = useState(null);
  const [roomSettings, setRoomSettings] = useState({
    allowParticipantControls: true,
    allowVideoSuggestions: true,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState([]);
  const [suggestUrl, setSuggestUrl] = useState("");
  const [suggestionSent, setSuggestionSent] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // keep refs in sync
  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);
  useEffect(() => { videoTypeRef.current = videoType; }, [videoType]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { ytSeekRef.current = ytSeekTime; }, [ytSeekTime]);

  // ─── visual viewport / keyboard detection ─────────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;

    // update --app-height immediately as keyboard animates (no delay)
    const updateHeight = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
    };

    // use focus events for keyboard state — avoids false positives from Safari UI chrome
    const onFocusIn = (e) => {
      if (!e.target.matches("input, textarea")) return;
      setKeyboardOpen(true);
    };

    const onFocusOut = (e) => {
      if (!e.target.matches("input, textarea")) return;
      setTimeout(() => {
        if (!document.activeElement?.matches("input, textarea")) {
          setKeyboardOpen(false);
        }
      }, 100);
    };

    updateHeight();
    if (vv) vv.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateHeight);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      if (vv) vv.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateHeight);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  // scroll to bottom when keyboard opens so input stays visible
  useEffect(() => {
    if (keyboardOpen) {
      requestAnimationFrame(() => {
        const el = chatMessagesRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [keyboardOpen]);

  // auto PiP when tab is hidden (HTML5 video only)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && videoTypeRef.current === "file" && playingRef.current) {
        htmlVideoRef.current?.requestPictureInPicture().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const isHost = useMemo(
    () => hostClientId === clientIdRef.current,
    [hostClientId]
  );

  // ─── apply remote state ────────────────────────────────────────────────────
  const applyRemoteState = (state) => {
    if (!state) return;
    lastVideoStateRef.current = state;

    const type = state.videoType || "file";
    const t = getExpectedTime(state);

    setVideoUrl(state.videoUrl || "");
    setVideoType(type);
    setPlaying(Boolean(state.isPlaying));
    setPlayerError("");

    if (type === "youtube" || type === "vk") {
      if (Math.abs(ytSeekRef.current - t) > 2) setYtSeekTime(t);
      return;
    }

    // file / direct video
    if (htmlVideoRef.current) {
      suppressHtmlRef.current = true;
      try {
        if (Math.abs(htmlVideoRef.current.currentTime - t) > 2)
          htmlVideoRef.current.currentTime = t;
        if (state.isPlaying && htmlVideoRef.current.paused)
          htmlVideoRef.current.play().catch(() => {});
        else if (!state.isPlaying && !htmlVideoRef.current.paused)
          htmlVideoRef.current.pause();
      } catch {}
      setTimeout(() => { suppressHtmlRef.current = false; }, 250);
    }
  };

  const requestFreshState = () => {
    socket.emit("get_room_state", { roomId }, (r) => {
      if (!r?.ok) return;
      if (r.users) setUsers(r.users);
      if (r.hostClientId) setHostClientId(r.hostClientId);
      if (r.messages) setMessages(r.messages);
      if (r.settings) setRoomSettings(r.settings);
      if (r.suggestions) setPendingSuggestions(r.suggestions);
      if (r.videoState) applyRemoteState(r.videoState);
    });
  };

  // ─── socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!username) { navigate("/"); return; }

    const join = () => {
      socket.emit("join_room", {
        roomId,
        username,
        clientId: clientIdRef.current,
        avatar: localStorage.getItem("laud_avatar") || "",
      }, () => {});
    };

    const onConnect = () => {
      setIsConnected(true);
      join();
      setTimeout(requestFreshState, 350);
    };
    const onDisconnect = () => setIsConnected(false);

    const onSnapshot = ({ users, hostClientId, videoState, messages, settings, suggestions }) => {
      setUsers(users || []);
      setHostClientId(hostClientId || "");
      setMessages(messages || []);
      if (settings) setRoomSettings(settings);
      if (suggestions) setPendingSuggestions(suggestions);
      if (videoState) applyRemoteState(videoState);
    };

    const onRoomUsers = (list) => setUsers(list || []);
    const onHostData = (d) => setHostClientId(d.hostClientId || "");
    const onVideoState = (s) => applyRemoteState(s);
    const onRoomSettings = (s) => {
      setRoomSettings(s || { allowParticipantControls: true, allowVideoSuggestions: true });
      if (!s?.allowVideoSuggestions) setPendingSuggestions([]);
    };
    const onNewSuggestion = (sug) => setPendingSuggestions((p) => [...p, sug]);
    const onSuggestionResponse = () => setSuggestionSent(false);

    const onKicked = () => {
      leavingRef.current = false;
      navigate("/");
    };

    const onPlay = ({ currentTime, lastActionAt }) =>
      applyRemoteState({ videoUrl: videoUrlRef.current, videoType: videoTypeRef.current, currentTime, isPlaying: true, lastActionAt });
    const onPause = ({ currentTime, lastActionAt }) =>
      applyRemoteState({ videoUrl: videoUrlRef.current, videoType: videoTypeRef.current, currentTime, isPlaying: false, lastActionAt });
    const onSeek = ({ currentTime, lastActionAt }) =>
      applyRemoteState({ videoUrl: videoUrlRef.current, videoType: videoTypeRef.current, currentTime, isPlaying: playingRef.current, lastActionAt });

    const onSyncProgress = ({ currentTime, isPlaying, lastActionAt }) => {
      if (isHost) return;
      const now = Date.now();
      if (now - lastSyncRef.current < 1200) return;
      lastSyncRef.current = now;

      const t = getExpectedTime({ currentTime, isPlaying, lastActionAt });

      if (videoTypeRef.current === "youtube" || videoTypeRef.current === "vk") {
        setPlaying(Boolean(isPlaying));
        if (Math.abs(ytSeekRef.current - t) > 2) setYtSeekTime(t);
        return;
      }

      if (htmlVideoRef.current) {
        suppressHtmlRef.current = true;
        try {
          if (Math.abs(htmlVideoRef.current.currentTime - t) > 2)
            htmlVideoRef.current.currentTime = t;
          if (isPlaying && htmlVideoRef.current.paused)
            htmlVideoRef.current.play().catch(() => {});
          else if (!isPlaying && !htmlVideoRef.current.paused)
            htmlVideoRef.current.pause();
        } catch {}
        setPlaying(Boolean(isPlaying));
        setTimeout(() => { suppressHtmlRef.current = false; }, 250);
      }
    };

    const onMessage = (data) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, data];
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_snapshot", onSnapshot);
    socket.on("room_users", onRoomUsers);
    socket.on("host_data", onHostData);
    socket.on("video_state", onVideoState);
    socket.on("room_settings", onRoomSettings);
    socket.on("new_suggestion", onNewSuggestion);
    socket.on("suggestion_response", onSuggestionResponse);
    socket.on("kicked", onKicked);
    socket.on("play_video", onPlay);
    socket.on("pause_video", onPause);
    socket.on("seek_video", onSeek);
    socket.on("sync_progress", onSyncProgress);
    socket.on("receive_message", onMessage);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_snapshot", onSnapshot);
      socket.off("room_users", onRoomUsers);
      socket.off("host_data", onHostData);
      socket.off("video_state", onVideoState);
      socket.off("room_settings", onRoomSettings);
      socket.off("new_suggestion", onNewSuggestion);
      socket.off("suggestion_response", onSuggestionResponse);
      socket.off("kicked", onKicked);
      socket.off("play_video", onPlay);
      socket.off("pause_video", onPause);
      socket.off("seek_video", onSeek);
      socket.off("sync_progress", onSyncProgress);
      socket.off("receive_message", onMessage);
      if (leavingRef.current) socket.emit("leave_room");
    };
  }, [roomId, username, navigate, isHost]); // eslint-disable-line

  // auto-scroll only when already at bottom
  useEffect(() => {
    if (!atBottomRef.current) return;
    const mobile = chatMessagesRef.current;
    const desktop = sideChatMessagesRef.current;
    if (mobile) mobile.scrollTop = mobile.scrollHeight;
    if (desktop) desktop.scrollTop = desktop.scrollHeight;
  }, [messages]);

  // ─── host actions ─────────────────────────────────────────────────────────
  const handleSetVideo = () => {
    if (!isHost || !inputUrl.trim()) return;
    const clean = normalizeVkUrl(inputUrl.trim());
    const type = detectVideoType(clean);
    setVideoUrl(clean);
    setVideoType(type);
    setPlaying(false);
    setYtSeekTime(0);
    setPlayerError("");
    lastFileSyncRef.current = -1;
    ytSeekRef.current = 0;
    lastSyncRef.current = 0;
    socket.emit("set_video", { roomId, videoUrl: clean, videoType: type });
    setInputUrl("");
  };

  const handleUpdateSettings = (patch) => {
    const next = { ...roomSettings, ...patch };
    setRoomSettings(next);
    socket.emit("update_room_settings", { roomId, settings: next });
  };

  const handleTransferHost = (targetClientId) => {
    socket.emit("transfer_host", { roomId, targetClientId }, (r) => {
      if (r?.ok) setSettingsOpen(false);
    });
  };

  const handleKickUser = (targetClientId) => {
    socket.emit("kick_user", { roomId, targetClientId });
  };

  const handleSuggestVideo = () => {
    if (!suggestUrl.trim()) return;
    const clean = normalizeVkUrl(suggestUrl.trim());
    socket.emit("suggest_video", { roomId, videoUrl: clean }, (r) => {
      if (r?.ok) { setSuggestionSent(true); setSuggestUrl(""); }
    });
  };

  const handleRespondSuggestion = (id, approved) => {
    socket.emit("respond_suggestion", { roomId, suggestionId: id, approved }, (r) => {
      if (r?.ok) {
        setPendingSuggestions((p) => p.filter((s) => s.id !== id));
        if (approved) { setYtSeekTime(0); ytSeekRef.current = 0; }
      }
    });
  };

  // file video handlers
  const onFilePlay = () => {
    if (!isHost || suppressHtmlRef.current || !htmlVideoRef.current) return;
    socket.emit("play_video", { roomId, currentTime: htmlVideoRef.current.currentTime });
  };
  const onFilePause = () => {
    if (!isHost || suppressHtmlRef.current || !htmlVideoRef.current) return;
    socket.emit("pause_video", { roomId, currentTime: htmlVideoRef.current.currentTime });
  };
  const onFileSeeked = () => {
    if (!isHost || suppressHtmlRef.current || !htmlVideoRef.current) return;
    socket.emit("seek_video", { roomId, currentTime: htmlVideoRef.current.currentTime });
  };
  const onFileTimeUpdate = () => {
    if (!isHost || !htmlVideoRef.current) return;
    const rounded = Math.floor(htmlVideoRef.current.currentTime);
    if (rounded === lastFileSyncRef.current) return;
    lastFileSyncRef.current = rounded;
    socket.emit("sync_progress", {
      roomId,
      currentTime: htmlVideoRef.current.currentTime,
      isPlaying: !htmlVideoRef.current.paused,
    });
  };

  const revertToHostState = () => {
    suppressHtmlRef.current = true;
    const v = htmlVideoRef.current;
    if (!v) return;
    if (playingRef.current && v.paused) v.play().catch(() => {});
    if (!playingRef.current && !v.paused) v.pause();
    setTimeout(() => { suppressHtmlRef.current = false; }, 300);
  };

  // VK — sync controlled externally via props; host uses sync bar
  const handleVkSyncPlay = () => {
    if (!isHost) return;
    socket.emit("play_video", { roomId, currentTime: ytSeekRef.current });
    setPlaying(true);
  };
  const handleVkSyncPause = () => {
    if (!isHost) return;
    socket.emit("pause_video", { roomId, currentTime: ytSeekRef.current });
    setPlaying(false);
  };

  // YouTube handlers
  const onYtPlay = (t) => { if (isHost) socket.emit("play_video", { roomId, currentTime: t }); };
  const onYtPause = (t) => { if (isHost) socket.emit("pause_video", { roomId, currentTime: t }); };
  const onYtProgress = (t, p) => {
    if (isHost) socket.emit("sync_progress", { roomId, currentTime: t, isPlaying: p ?? playingRef.current });
  };

  // chat
  const sendMessage = () => {
    if (!message.trim()) return;
    const text = message.trim();
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    socket.emit("send_message", {
      roomId, username, message: text, clientMessageId: id,
      avatar: localStorage.getItem("laud_avatar") || "",
      replyTo: replyTo ? { id: replyTo.id, username: replyTo.username, message: replyTo.message } : null,
    });
    setMessage("");
    setReplyTo(null);
  };

  const handleLeave = () => { leavingRef.current = true; navigate("/"); };

  const handleChatScroll = useCallback((e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = () => {
    atBottomRef.current = true;
    setIsAtBottom(true);
    const mobile = chatMessagesRef.current;
    const desktop = sideChatMessagesRef.current;
    if (mobile) mobile.scrollTo({ top: mobile.scrollHeight, behavior: "smooth" });
    if (desktop) desktop.scrollTo({ top: desktop.scrollHeight, behavior: "smooth" });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const imageData = await resizeImageForChat(file);
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      socket.emit("send_message", {
        roomId, username, message: "", clientMessageId: id,
        avatar: localStorage.getItem("laud_avatar") || "",
        replyTo: null,
        type: "image",
        gifUrl: imageData,
      });
    } catch {}
  };

  const handlePiP = () => {
    const v = htmlVideoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      v.requestPictureInPicture().catch(() => {});
    }
  };

  // ─── render helpers ────────────────────────────────────────────────────────

  const canControl = isHost || roomSettings.allowParticipantControls;

  const renderPlayer = () => {
    if (!videoUrl) {
      return (
        <div className="player-placeholder">
          <span className="player-placeholder-icon">▶</span>
          <span className="player-placeholder-text">Видео не выбрано</span>
        </div>
      );
    }

    const overlay = !canControl ? (
      <div className="player-controls-overlay">
        <span className="player-controls-overlay-hint">Управление заблокировано</span>
      </div>
    ) : null;

    if (videoType === "youtube") {
      return (
        <div className="player-stage" style={{ position: "relative" }}>
          <YouTubeSyncPlayer
            videoUrl={videoUrl}
            playing={playing}
            seekToSeconds={ytSeekTime}
            isHost={isHost}
            onPlay={onYtPlay}
            onPause={onYtPause}
            onProgress={onYtProgress}
            onError={(t) => setPlayerError(t)}
          />
          {overlay}
        </div>
      );
    }

    if (videoType === "vk") {
      return (
        <>
          <div className="player-stage" style={{ position: "relative" }}>
            <VKSyncPlayer
              videoUrl={videoUrl}
              playing={playing}
              seekToSeconds={ytSeekTime}
            />
            {overlay}
          </div>
          {isHost && (
            <div className="vk-sync-bar">
              <button
                className="btn btn-secondary suggestion-btn"
                onClick={playing ? handleVkSyncPause : handleVkSyncPlay}
              >
                {playing ? "⏸ Пауза" : "▶ Играть"}
              </button>
              <span className="vk-sync-hint">
                Используй эти кнопки для синхронизации VK
              </span>
            </div>
          )}
        </>
      );
    }

    // file / direct url
    return (
      <div className="player-stage" style={{ position: "relative" }}>
        <video
          ref={htmlVideoRef}
          src={videoUrl}
          controls
          style={{ width: "100%", height: "100%", display: "block", background: "#000" }}
          onPlay={() => isHost ? onFilePlay() : revertToHostState()}
          onPause={() => isHost ? onFilePause() : revertToHostState()}
          onSeeked={() => isHost ? onFileSeeked() : requestFreshState()}
          onTimeUpdate={onFileTimeUpdate}
          onLoadedMetadata={() => {
            if (!isHost && lastVideoStateRef.current && htmlVideoRef.current) {
              const t = getExpectedTime(lastVideoStateRef.current);
              suppressHtmlRef.current = true;
              try {
                if (Math.abs(htmlVideoRef.current.currentTime - t) > 1)
                  htmlVideoRef.current.currentTime = t;
                if (lastVideoStateRef.current.isPlaying)
                  htmlVideoRef.current.play().catch(() => {});
              } catch {}
              setTimeout(() => { suppressHtmlRef.current = false; }, 300);
            }
          }}
          onWaiting={() => { if (!isHost) requestFreshState(); }}
        />
        {overlay}
        {document.pictureInPictureEnabled && (
          <button className="pip-btn" onClick={handlePiP} title="Картинка в картинке">⧉</button>
        )}
      </div>
    );
  };

  const renderMsg = (msg) => {
    const sys = msg.system || msg.username === "Система";
    if (sys) return (
      <div key={msg.id} className="msg-system">{msg.message}</div>
    );
    return (
      <div key={msg.id} className="msg-row" onClick={() => !sys && setReplyTo(msg)}>
        {msg.avatar
          ? <div className="msg-avatar"><img src={msg.avatar} alt="" /></div>
          : <div className="msg-avatar-letter">{(msg.username || "?")[0].toUpperCase()}</div>
        }
        <div className="msg-content">
          {msg.replyTo && (
            <div className="msg-reply">
              <span className="msg-reply-author">{msg.replyTo.username}</span>
              <span className="msg-reply-text">{msg.replyTo.message}</span>
            </div>
          )}
          <div className="msg-header">
            <span className="msg-name">{msg.username}</span>
            <span className="msg-time">{msg.time}</span>
          </div>
          {msg.type === "image"
            ? <img className="msg-image" src={msg.gifUrl} alt="photo" onClick={(e) => e.stopPropagation()} />
            : <div className="msg-body">{msg.message}</div>
          }
        </div>
      </div>
    );
  };

  const renderUserItem = (user) => (
    <div key={user.clientId || user.id} className="user-item">
      <div className="user-avatar">
        {user.avatar
          ? <img src={user.avatar} alt="" />
          : (user.username || "?")[0].toUpperCase()
        }
      </div>
      <div className="user-meta">
        <span className="user-name">{user.username}</span>
        <span className="user-status">online</span>
      </div>
      {user.clientId === hostClientId && <span className="host-badge">HOST</span>}
    </div>
  );

  const renderSettings = () => {
    if (!settingsOpen) return null;
    const others = users.filter((u) => u.clientId !== clientIdRef.current);

    const Toggle = ({ checked, onChange }) => (
      <div
        className={`toggle-track${checked ? " on" : ""}`}
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") onChange(); }}
      >
        <div className="toggle-thumb" />
      </div>
    );

    return (
      <>
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)} />
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Настройки комнаты</h2>
            <button className="btn btn-icon" onClick={() => setSettingsOpen(false)}>✕</button>
          </div>

          {/* Toggles */}
          <div className="modal-section">
            <div className="toggle-row">
              <div className="toggle-label-group">
                <span className="toggle-label">Управление участниками</span>
                <span className="toggle-desc">Участники могут ставить паузу и перематывать</span>
              </div>
              <Toggle
                checked={roomSettings.allowParticipantControls}
                onChange={() => handleUpdateSettings({ allowParticipantControls: !roomSettings.allowParticipantControls })}
              />
            </div>
          </div>

          <div className="modal-divider" />

          <div className="modal-section">
            <div className="toggle-row">
              <div className="toggle-label-group">
                <span className="toggle-label">Предложения видео</span>
                <span className="toggle-desc">Участники могут предлагать видео хосту</span>
              </div>
              <Toggle
                checked={roomSettings.allowVideoSuggestions}
                onChange={() => handleUpdateSettings({ allowVideoSuggestions: !roomSettings.allowVideoSuggestions })}
              />
            </div>
          </div>

          {/* Participants management */}
          {others.length > 0 && (
            <>
              <div className="modal-divider" />
              <div className="modal-section">
                <div className="modal-section-label">Участники</div>
                {others.map((u) => (
                  <div key={u.clientId} className="modal-user-row">
                    <div className="user-avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                      {u.avatar ? <img src={u.avatar} alt="" /> : (u.username || "?")[0].toUpperCase()}
                    </div>
                    <span className="modal-user-name">{u.username}</span>
                    <button
                      className="btn btn-secondary modal-transfer-btn"
                      onClick={() => handleTransferHost(u.clientId)}
                      title="Передать права хоста"
                    >
                      Хост
                    </button>
                    <button
                      className="btn modal-kick-btn"
                      onClick={() => handleKickUser(u.clientId)}
                      title="Выгнать из комнаты"
                    >
                      Кик
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </>
    );
  };

  // ─── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className={`room-shell${keyboardOpen ? " keyboard-open" : ""}`}>
      {renderSettings()}

      {/* Participants drawer (mobile) */}
      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="participants-drawer">
            <div className="drawer-header">
              <span className="drawer-title">Участники ({users.length})</span>
              <button className="btn btn-icon" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <div className="drawer-body">
              {users.map(renderUserItem)}
            </div>
          </div>
        </>
      )}

      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo">LAUD</span>
          <div className="topbar-meta">
            <span className="topbar-meta-room">#{roomId}</span>
            {isHost && (
              <>
                <span className="topbar-meta-sep">·</span>
                <span className="topbar-meta-role">Host</span>
              </>
            )}
            <span className="topbar-meta-sep">·</span>
            <div className="topbar-meta-status">
              <span className={`status-dot${isConnected ? "" : " offline"}`} />
              <span>{isConnected ? "Онлайн" : "..."}</span>
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="mobile-menu-wrap" style={{ display: "block" }}>
            <button
              className="btn btn-icon"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Меню"
            >
              ☰
            </button>
            {menuOpen && (
              <>
                <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="mobile-menu-dropdown">
                  <button className="mobile-menu-item" onClick={() => { setDrawerOpen(true); setMenuOpen(false); }}>
                    Участники
                  </button>
                  {isHost && (
                    <button className="mobile-menu-item" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>
                      Настройки
                    </button>
                  )}
                  <button className="mobile-menu-item mobile-menu-leave" onClick={handleLeave}>
                    Выйти
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="room-body">
        {/* Main panel: player + chat */}
        <div className="main-panel">
          {/* Player area */}
          <div className="player-area">
            {playerError && (
              <div style={{ fontSize: 13, color: "#f87171", padding: "4px 0" }}>{playerError}</div>
            )}

            {/* Host suggestions */}
            {isHost && pendingSuggestions.length > 0 && (
              <div className="suggestions-panel">
                <div className="suggestions-panel-title">
                  Предложения ({pendingSuggestions.length})
                </div>
                {pendingSuggestions.map((sug) => (
                  <div key={sug.id} className="suggestion-item">
                    <div className="suggestion-info">
                      <span className="suggestion-from">{sug.username}</span>
                      <span className="suggestion-url">{sug.videoUrl}</span>
                    </div>
                    <div className="suggestion-actions">
                      <button className="btn btn-primary suggestion-btn" onClick={() => handleRespondSuggestion(sug.id, true)}>✓</button>
                      <button className="btn btn-secondary suggestion-btn" onClick={() => handleRespondSuggestion(sug.id, false)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Host URL input */}
            {isHost && (
              <div className="host-controls">
                <input
                  className="app-input"
                  type="url"
                  inputMode="url"
                  placeholder="Youtube / VK / .mp4"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSetVideo(); }}
                />
                <button className="host-play-btn" onClick={handleSetVideo} aria-label="Поставить">▶</button>
              </div>
            )}

            {/* Participant suggest */}
            {!isHost && roomSettings.allowVideoSuggestions && (
              suggestionSent
                ? <div className="suggest-sent">Предложение отправлено — ожидайте одобрения</div>
                : (
                  <div className="suggest-row">
                    <input
                      className="app-input"
                      type="url"
                      inputMode="url"
                      placeholder="Предложить видео хосту"
                      value={suggestUrl}
                      onChange={(e) => setSuggestUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSuggestVideo(); }}
                    />
                    <button className="host-play-btn" onClick={handleSuggestVideo} aria-label="Предложить">▶</button>
                  </div>
                )
            )}

            {/* Player */}
            {renderPlayer()}
          </div>

          {/* Chat panel */}
          <div className="chat-panel">
            {replyTo && (
              <div className="reply-preview">
                <div className="reply-preview-body">
                  <div className="reply-preview-name">↩ {replyTo.username}</div>
                  <div className="reply-preview-text">{replyTo.message}</div>
                </div>
                <button className="reply-clear" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}

            <div className="chat-messages" ref={chatMessagesRef} onScroll={handleChatScroll}>
              {messages.length === 0 && (
                <div className="chat-empty">
                  <span className="chat-empty-icon">💬</span>
                  <span className="chat-empty-text">Пока тихо — скажи привет</span>
                </div>
              )}
              {messages.map(renderMsg)}
              <div ref={messagesEndRef} />
            </div>

            {!isAtBottom && (
              <button className="scroll-to-bottom-btn" onClick={scrollToBottom} aria-label="Вниз">↓</button>
            )}

            <div className="chat-input-row">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handlePhotoUpload}
              />
              <button
                className="chat-photo-btn"
                onClick={() => photoInputRef.current?.click()}
                aria-label="Фото"
              ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><circle cx="12" cy="14" r="2.5"/></svg></button>
              <input
                className="app-input chat-input"
                type="text"
                placeholder={replyTo ? `Ответ ${replyTo.username}…` : "Сообщение…"}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
              />
              <button className="send-btn" onClick={sendMessage} aria-label="Отправить">→</button>
            </div>
          </div>
        </div>

        {/* Side panel (desktop only) */}
        <aside className="side-panel desktop-only" style={{ display: "flex" }}>
          {/* Participants */}
          <div className="side-section participants-section">
            <div className="side-section-header">
              <h2 className="side-section-title">Участники</h2>
              <div className="side-section-sub">{users.length} онлайн</div>
            </div>
            <div className="participants-list">
              {users.map(renderUserItem)}
            </div>
          </div>

          {/* Side chat */}
          <div className="side-section side-chat">
            <div className="side-section-header">
              <h2 className="side-section-title">Чат</h2>
              <div className="side-section-sub">Общение в реальном времени</div>
            </div>
            <div className="side-chat-messages" ref={sideChatMessagesRef} onScroll={handleChatScroll}>
              {messages.length === 0 && (
                <div className="chat-empty" style={{ flex: "none", padding: "20px 0" }}>
                  <span className="chat-empty-icon">💬</span>
                  <span className="chat-empty-text">Пока тихо</span>
                </div>
              )}
              {messages.map(renderMsg)}
            </div>
            {!isAtBottom && (
              <button className="scroll-to-bottom-btn side-scroll-btn" onClick={scrollToBottom} aria-label="Вниз">↓</button>
            )}
            <div className="side-chat-input">
              <div className="chat-input-row" style={{ width: "100%" }}>
                <button
                  className="chat-photo-btn"
                  onClick={() => photoInputRef.current?.click()}
                  aria-label="Фото"
                ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><circle cx="12" cy="14" r="2.5"/></svg></button>
                <input
                  className="chat-input"
                  type="text"
                  placeholder="Сообщение…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
                />
                <button className="send-btn" onClick={sendMessage} aria-label="Отправить">▶</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}