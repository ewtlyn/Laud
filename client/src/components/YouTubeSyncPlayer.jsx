import { useEffect, useRef, useState } from "react";

function extractVideoId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }

    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    }

    return null;
  } catch {
    return null;
  }
}

function loadYouTubeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("YOUTUBE_API_LOAD_FAILED"));
      document.body.appendChild(script);
    }

    const previousHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousHandler === "function") {
        previousHandler();
      }
      resolve(window.YT);
    };

    setTimeout(() => {
      if (!(window.YT && window.YT.Player)) {
        reject(new Error("YOUTUBE_API_TIMEOUT"));
      }
    }, 10000);
  });
}

export default function YouTubeSyncPlayer({
  videoUrl,
  playing,
  seekToSeconds = 0,
  isHost,
  onReady,
  onPlay,
  onPause,
  onProgress,
  onError
}) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lastAppliedSeekRef = useRef(-1);
  const suppressEventsRef = useRef(false);
  const readyRef = useRef(false);
  const lastProgressSentRef = useRef(0);
  const [errorText, setErrorText] = useState("");

  const onReadyRef = useRef(onReady);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onProgressRef = useRef(onProgress);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onPlayRef.current = onPlay;
  }, [onPlay]);

  useEffect(() => {
    onPauseRef.current = onPause;
  }, [onPause]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let isMounted = true;
    readyRef.current = false;
    setErrorText("");

    const videoId = extractVideoId(videoUrl);

    if (!videoId || !mountRef.current) {
      setErrorText("Не удалось распознать ссылку YouTube.");
      return;
    }

    loadYouTubeApi()
      .then((YT) => {
        if (!isMounted || !mountRef.current) return;

        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch {}
          playerRef.current = null;
        }

        mountRef.current.innerHTML = "";
        const playerNode = document.createElement("div");
        playerNode.style.width = "100%";
        playerNode.style.height = "100%";
        mountRef.current.appendChild(playerNode);

        playerRef.current = new YT.Player(playerNode, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            origin: window.location.origin,
            enablejsapi: 1
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              setErrorText("");

              try {
                const iframe = playerRef.current?.getIframe?.();
                if (iframe) {
                  iframe.style.width = "100%";
                  iframe.style.height = "100%";
                  iframe.style.border = "0";
                  iframe.style.display = "block";
                }
              } catch {}

              onReadyRef.current?.();
            },
            onStateChange: (event) => {
              if (suppressEventsRef.current) return;

              if (event.data === YT.PlayerState.PLAYING) {
                const currentTime = playerRef.current?.getCurrentTime?.() || 0;
                onPlayRef.current?.(currentTime);
              }

              if (event.data === YT.PlayerState.PAUSED) {
                const currentTime = playerRef.current?.getCurrentTime?.() || 0;
                onPauseRef.current?.(currentTime);
              }
            },
            onError: (event) => {
              const errorMap = {
                2: "Некорректный YouTube URL или videoId.",
                5: "Ошибка YouTube HTML5 player.",
                100: "Видео не найдено или удалено.",
                101: "Встраивание этого видео запрещено владельцем.",
                150: "Встраивание этого видео запрещено владельцем."
              };

              const message = errorMap[event.data] || `Ошибка YouTube: ${event.data}`;
              setErrorText(message);
              onErrorRef.current?.(message);
            }
          }
        });
      })
      .catch((error) => {
        const message =
          error?.message === "YOUTUBE_API_TIMEOUT"
            ? "YouTube API не загрузился вовремя."
            : "Не удалось загрузить YouTube player.";

        setErrorText(message);
        onErrorRef.current?.(message);
      });

    return () => {
      isMounted = false;
      readyRef.current = false;

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;

    const nextSeek = Number(seekToSeconds) || 0;
    const roundedSeek = Math.floor(nextSeek);

    if (roundedSeek !== lastAppliedSeekRef.current) {
      lastAppliedSeekRef.current = roundedSeek;
      suppressEventsRef.current = true;

      try {
        player.seekTo(nextSeek, true);
      } catch {}

      setTimeout(() => {
        suppressEventsRef.current = false;
      }, 250);
    }

    suppressEventsRef.current = true;

    try {
      if (playing) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch {}

    setTimeout(() => {
      suppressEventsRef.current = false;
    }, 250);
  }, [playing, seekToSeconds]);

  useEffect(() => {
    if (!isHost || !playerRef.current || !readyRef.current) return;

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      try {
        const currentTime = playerRef.current?.getCurrentTime?.() || 0;
        const rounded = Math.floor(currentTime);

        if (rounded !== lastProgressSentRef.current) {
          lastProgressSentRef.current = rounded;
          onProgressRef.current?.(currentTime);
        }
      } catch {}
    }, 1500);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isHost, videoUrl]);

  return (
    <div className="player-wrap">
      {errorText ? (
        <div className="player-error">{errorText}</div>
      ) : (
        <div
          ref={mountRef}
          style={{
            width: "100%",
            height: "100%",
            background: "#000"
          }}
        />
      )}
    </div>
  );
}