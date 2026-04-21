import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function HomePage() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const savedName = localStorage.getItem("laudUsername");
    if (savedName) {
      setUsername(savedName);
    }
  }, []);

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

  return (
    <div className="home-page">
      <div className="home-card">
        <h1 className="home-title">LAUD</h1>
        <p className="home-subtitle">совместный просмотр с друзьями</p>

        <input
          className="app-input"
          type="text"
          placeholder="Ваше имя"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <button className="app-button app-button-primary" onClick={createRoom}>
          Создать комнату
        </button>

        <div className="home-divider">или</div>

        <input
          className="app-input"
          type="text"
          placeholder="ID комнаты"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />

        <button className="app-button app-button-secondary" onClick={joinRoom}>
          Войти
        </button>
      </div>
    </div>
  );
}

export default HomePage;