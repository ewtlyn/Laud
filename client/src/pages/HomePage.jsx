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

function HomePage() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [avatar, setAvatar] = useState("");
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const savedName = localStorage.getItem("laudUsername");
    if (savedName) setUsername(savedName);
    const savedAvatar = localStorage.getItem("laud_avatar");
    if (savedAvatar) setAvatar(savedAvatar);
  }, []);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const base64 = await resizeImageToBase64(file);
      setAvatar(base64);
      localStorage.setItem("laud_avatar", base64);
    } catch {}
  };

  const removeAvatar = () => {
    setAvatar("");
    localStorage.removeItem("laud_avatar");
  };

  const createRoom = () => {
    if (!username.trim()) {
      alert("Введите имя");
      return;
    }

    localStorage.setItem("laudUsername", username.trim());

    const newRoomId = Math.random().toString(36).slice(2, 8);
    navigate(`/room/${newRoomId}`, {
      state: { username: username.trim() }
    });
  };

  const joinRoom = () => {
    if (!username.trim() || !roomId.trim()) {
      alert("Введите имя и ID комнаты");
      return;
    }

    localStorage.setItem("laudUsername", username.trim());

    navigate(`/room/${roomId.trim()}`, {
      state: { username: username.trim() }
    });
  };

  const initial = username.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="home-page">
      <div className="home-card">
        <h1 className="home-title">LAUD</h1>
        <p className="home-subtitle">совместный просмотр с друзьями</p>

        <div className="avatar-upload-wrap">
          <button
            className="avatar-upload-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Загрузить аватарку"
          >
            {avatar ? (
              <img src={avatar} className="avatar-upload-img" alt="" />
            ) : (
              <span className="avatar-upload-placeholder">{initial}</span>
            )}
            <span className="avatar-upload-overlay">
              {avatar ? "Изменить" : "Фото"}
            </span>
          </button>

          {avatar && (
            <button
              className="avatar-remove-btn"
              type="button"
              onClick={removeAvatar}
              aria-label="Удалить аватарку"
            >
              ✕
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleAvatarChange}
        />

        <input
          className="app-input"
          type="text"
          placeholder="Ваше имя"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") createRoom(); }}
        />

        <button className="primary-button" onClick={createRoom}>
          Создать комнату
        </button>

        <div className="home-divider">или</div>

        <input
          className="app-input"
          type="text"
          placeholder="ID комнаты"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") joinRoom(); }}
        />

        <button className="secondary-button" onClick={joinRoom}>
          Войти
        </button>
      </div>
    </div>
  );
}

export default HomePage;
