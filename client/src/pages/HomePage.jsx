import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const SIZE = 64;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function HomePage() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [avatar, setAvatar] = useState("");
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const name = localStorage.getItem("laudUsername");
    if (name) setUsername(name);
    const av = localStorage.getItem("laud_avatar");
    if (av) setAvatar(av);
  }, []);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const b64 = await resizeImageToBase64(file);
      setAvatar(b64);
      localStorage.setItem("laud_avatar", b64);
    } catch {}
  };

  const removeAvatar = (e) => {
    e.stopPropagation();
    setAvatar("");
    localStorage.removeItem("laud_avatar");
  };

  const go = (id) => {
    if (!username.trim()) { alert("Введите имя"); return; }
    localStorage.setItem("laudUsername", username.trim());
    navigate(`/room/${id}`, { state: { username: username.trim() } });
  };

  const createRoom = () => go(Math.random().toString(36).slice(2, 8));

  const joinRoom = () => {
    if (!roomId.trim()) { alert("Введите ID комнаты"); return; }
    go(roomId.trim());
  };

  const initial = username.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="home-page">
      <div className="home-card">
        <div className="home-logo">
          <div className="home-logo-text">LAUD</div>
        </div>
        <p className="home-tagline">совместный просмотр с друзьями</p>

        {/* Avatar */}
        <div className="avatar-wrap">
          <button
            className="avatar-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Загрузить аватар"
          >
            {avatar
              ? <img src={avatar} className="avatar-img" alt="" />
              : <span className="avatar-initial">{initial}</span>
            }
            <span className="avatar-overlay">{avatar ? "Изменить" : "Фото"}</span>
          </button>
          {avatar && (
            <button className="avatar-remove" type="button" onClick={removeAvatar} aria-label="Удалить">✕</button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleAvatarChange}
        />

        <div className="home-field">
          <input
            className="app-input"
            type="text"
            placeholder="Ваше имя"
            value={username}
            autoComplete="nickname"
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createRoom(); }}
          />
        </div>

        <button className="btn btn-primary" onClick={createRoom}>
          Создать комнату
        </button>

        <div className="home-divider">или войти</div>

        <div className="home-field">
          <input
            className="app-input"
            type="text"
            placeholder="ID комнаты"
            value={roomId}
            autoComplete="off"
            onChange={(e) => setRoomId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") joinRoom(); }}
          />
        </div>

        <button className="btn btn-secondary" onClick={joinRoom}>
          Войти
        </button>
      </div>
    </div>
  );
}