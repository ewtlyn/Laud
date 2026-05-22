import { useEffect, useRef, useState } from "react";

function addJsApi(url) {
  if (!url) return url;
  if (url.includes("js_api=1")) return url;
  return url + (url.includes("?") ? "&" : "?") + "js_api=1";
}

export default function VKSyncPlayer({
  videoUrl,
  playing,
  seekToSeconds = 0,
  isHost,
  onPlay,
  onPause,
  onProgress
}) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const suppressRef = useRef(false);
  const currentPosRef = useRef(0);
  const [playerReadyCount, setPlayerReadyCount] = useState(0);

  const isHostRef = useRef(isHost);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onProgressRef = useRef(onProgress);

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  const send = (method, params = {}) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ method, params }),
        "*"
      );
    } catch {}
  };

  // listen for events from VK iframe
  useEffect(() => {
    readyRef.current = false;
    currentPosRef.current = 0;

    const onMessage = (e) => {
      let data;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }

      if (data?.type !== "vid_ev") return;
      const pl = data.payload || {};

      if (pl.type === "inited") {
        readyRef.current = true;
        setPlayerReadyCount((c) => c + 1);
        return;
      }

      if (suppressRef.current) return;

      const pos = pl.position ?? pl.time ?? 0;
      currentPosRef.current = pos;

      if (pl.type === "started" && isHostRef.current) {
        onPlayRef.current?.(pos);
      }

      if (pl.type === "paused" && isHostRef.current) {
        onPauseRef.current?.(pos);
      }

      if (pl.type === "secondChange" && isHostRef.current) {
        onProgressRef.current?.(pos, true);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      readyRef.current = false;
    };
  }, [videoUrl]);

  // apply state when playing/seekToSeconds changes OR player becomes ready
  useEffect(() => {
    if (!readyRef.current) return;

    suppressRef.current = true;

    const diff = Math.abs(currentPosRef.current - seekToSeconds);
    if (diff > 2) {
      send("seek", { time: seekToSeconds });
    }

    if (playing) {
      send("play");
    } else {
      send("pause");
    }

    setTimeout(() => { suppressRef.current = false; }, 600);
  }, [playing, seekToSeconds, playerReadyCount]);

  return (
    <div className="vk-player-wrap">
      <iframe
        ref={iframeRef}
        src={addJsApi(videoUrl)}
        title="VK Video"
        className="player-iframe vk-frame"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      />
    </div>
  );
}
