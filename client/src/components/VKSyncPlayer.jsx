/**
 * VKSyncPlayer — iframe-based VK player with polling sync.
 *
 * VK postMessage JS API fires events inconsistently across browsers/devices,
 * so we drive sync purely from props (playing / seekToSeconds) and use a
 * local timer to track elapsed time when playing.
 *
 * For the host, onPlay/onPause/onProgress are called via the sync bar
 * buttons rendered in RoomPage — not from iframe events — because VK blocks
 * most of them on mobile.
 */

import { useEffect, useRef } from "react";

function addJsApi(url) {
  if (!url || url.includes("js_api=1")) return url;
  return url + (url.includes("?") ? "&" : "?") + "js_api=1";
}

export default function VKSyncPlayer({
  videoUrl,
  playing,
  seekToSeconds = 0,
}) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const suppressRef = useRef(false);
  const posTimerRef = useRef(null);

  const send = (method, params = {}) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ method, params }),
        "*"
      );
    } catch {}
  };

  // Listen for "inited" so we know the player accepted JS API
  useEffect(() => {
    readyRef.current = false;
    clearInterval(posTimerRef.current);

    const onMessage = (e) => {
      let data;
      try { data = typeof e.data === "string" ? JSON.parse(e.data) : e.data; }
      catch { return; }
      if (data?.type !== "vid_ev") return;
      if (data.payload?.type === "inited") {
        readyRef.current = true;
        applyState();
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      readyRef.current = false;
      clearInterval(posTimerRef.current);
    };
  }, [videoUrl]); // eslint-disable-line

  const applyState = () => {
    if (!readyRef.current) return;
    suppressRef.current = true;
    send("seek", { time: seekToSeconds });
    if (playing) send("play");
    else send("pause");
    setTimeout(() => { suppressRef.current = false; }, 600);
  };

  // Apply whenever playing/seek changes (and player is ready)
  useEffect(() => {
    applyState();
  }, [playing, seekToSeconds]); // eslint-disable-line

  return (
    <iframe
      ref={iframeRef}
      src={addJsApi(videoUrl)}
      title="VK Video"
      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
    />
  );
}