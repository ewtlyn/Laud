import { useEffect, useRef } from "react";

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
  return new Promise((resolve) => {
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
      document.body.appendChild(script);
    }

    const previousHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousHandler === "function") {
        previousHandler();
      }
      resolve(window.YT);
    };
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
  onProgress
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lastAppliedSeekRef = useRef(-1);
  const suppressEventsRef = useRef(false);

  const onReadyRef = useRef(onReady);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onProgressRef = useRef(onProgress);

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
    let isMounted = true;

    const videoId = extractVideoId(videoUrl);
    if (!videoId || !containerRef.current) return;

    loadYouTubeApi().then((YT) => {
      if (!isMounted || !containerRef.current) return;

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      playerRef.current = new YT.Player(containerRef.current, {
  videoId,
  width: "100%",
  height: "100%",
  host: "https://www.youtube.com",
  playerVars: {
    autoplay: 0,
    controls: 1,
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
    enablejsapi: 1,
    origin: window.location.origin
  },
  events: {
    onReady: () => {
      if (!isMounted) return;
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
      console.error("YT iframe error code:", event.data);
    }
  }
});
    });

    return () => {
      isMounted = false;

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const roundedSeek = Math.floor(seekToSeconds || 0);

    if (roundedSeek !== lastAppliedSeekRef.current) {
      lastAppliedSeekRef.current = roundedSeek;

      suppressEventsRef.current = true;
      try {
        player.seekTo(seekToSeconds || 0, true);
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
    if (!isHost || !playerRef.current) return;

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.() || 0;
      onProgressRef.current?.(currentTime);
    }, 1000);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isHost, videoUrl]);

  return (
    <div className="player-wrap">
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          background: "#000"
        }}
      />
    </div>
  );
}