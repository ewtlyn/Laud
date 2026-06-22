# Laud

Веб-платформа синхронного просмотра видео — аналог Rave. Совместный просмотр YouTube и VK видео с синхронизацией в реальном времени, чатом и комнатами.

![Node.js](https://img.shields.io/badge/Backend-Node.js-339933)
![Vite](https://img.shields.io/badge/Frontend-Vite-646CFF)
![WebSocket](https://img.shields.io/badge/Realtime-WebSocket-black)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7)

---

## О проекте

Laud позволяет смотреть видео с YouTube и VK вместе с друзьями: создаёшь комнату, скидываешь ссылку, и плеер у всех участников синхронизируется — пауза, перемотка и смена видео мгновенно отражаются у всех в комнате. Внутри комнаты есть чат для обсуждения происходящего на экране.

## Возможности

- Создание комнат для совместного просмотра
- Синхронизация воспроизведения (play/pause/seek) между всеми участниками комнаты
- Поддержка двух источников видео: YouTube и VK
- Встроенный чат в реальном времени
- Тёмный минималистичный интерфейс

## Стек технологий

- **Backend:** Node.js (WebSocket-сервер для синхронизации состояния)
- **Frontend:** Vite + JavaScript
- **Реалтайм:** WebSocket-соединения для синхронизации плеера и чата
- **Деплой:** Render — backend и frontend разнесены на два независимых сервиса

## Архитектура

Проект состоит из двух самостоятельных частей, которые деплоятся раздельно:

```
laud/
  server.js       ← WebSocket + REST backend
  package.json
  src/             ← фронтенд (Vite)
  dist/            ← собранный билд фронтенда
```

**Backend (Web Service на Render)**
- Держит состояние комнат и синхронизирует воспроизведение между клиентами через WebSocket
- Раздаёт REST-эндпоинты для создания/поиска комнат
- Порт берётся из `process.env.PORT`

**Frontend (Static Site на Render)**
- Собирается через `vite build`, раздаётся как статика
- Адрес backend передаётся через переменную окружения `VITE_SERVER_URL`, чтобы фронт знал, куда стучаться после деплоя

**Деплой**
https://laud-client.onrender.com
<img width="1437" height="778" alt="Screenshot 2026-06-22 at 20 18 07" src="https://github.com/user-attachments/assets/1c2f8b28-9efd-4d80-a836-8cc6e270d130" />
<img width="1440" height="783" alt="Screenshot 2026-06-22 at 20 20 50" src="https://github.com/user-attachments/assets/4e92f36f-a3ca-4fc0-aa8b-e1b8988bea81" />


## Планы по развитию

- Поддержка дополнительных видеоплатформ
- История просмотров в комнате
- Реакции и эмодзи поверх видео
