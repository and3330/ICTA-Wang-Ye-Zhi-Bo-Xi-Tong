import { useEffect, useRef, useState } from "react";
import type { PlaybackSource } from "@/lib/media";

export type PlayerAdapter = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  getDuration: () => Promise<number>;
  getCurrentTime: () => Promise<number>;
  setCurrentTime: (seconds: number) => Promise<number>;
  destroy: () => void;
};

type PlayerEvents = {
  onTimeUpdate?: (seconds: number, duration?: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onReady?: (player: PlayerAdapter) => void;
};

const loadedScripts = new Map<string, Promise<void>>();
function loadScript(src: string, ready: () => boolean) {
  if (ready()) return Promise.resolve();
  const existing = loadedScripts.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("影片播放器載入失敗"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    // A temporary CDN/network failure must not poison every later retry.
    loadedScripts.delete(src);
    throw error;
  });
  loadedScripts.set(src, promise);
  return promise;
}

export function normalizeVimeoEmbedUrl(value?: string) {
  if (!value) return "";
  const trimmed = value.trim();
  let videoId = /^\d+$/.test(trimmed) ? trimmed : "";
  let hash = "";
  if (!videoId) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || !["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname.toLowerCase())) return "";
      const match = url.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([A-Za-z0-9]+))?\/?$/)
        || url.pathname.match(/^\/channels\/[^/]+\/(\d+)\/?$/)
        || url.pathname.match(/^\/groups\/[^/]+\/videos\/(\d+)\/?$/)
        || url.pathname.match(/^\/ondemand\/[^/]+\/(\d+)\/?$/);
      if (!match) return "";
      videoId = match[1];
      hash = url.searchParams.get("h") || match[2] || "";
    } catch {
      return "";
    }
  }
  const params = new URLSearchParams({ autoplay: "0", title: "0", byline: "0", portrait: "0", controls: "0" });
  if (hash) params.set("h", hash);
  return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?${params.toString()}`;
}

function bunnyCallbackNumber(player: any, method: "getDuration" | "getCurrentTime") {
  return new Promise<number>((resolve, reject) => {
    try {
      player[method]((value: unknown) => resolve(Number(value) || 0));
    } catch (error) {
      reject(error);
    }
  });
}

export function createPlayerAdapter(provider: "vimeo" | "bunny", player: any): PlayerAdapter {
  if (provider === "vimeo") {
    return {
      play: () => Promise.resolve(player.play()).then(() => undefined),
      pause: () => Promise.resolve(player.pause()).then(() => undefined),
      setMuted: (muted) => Promise.resolve(player.setMuted(muted)).then(() => undefined),
      setVolume: (volume) => Promise.resolve(player.setVolume(Math.max(0, Math.min(1, volume)))).then(() => undefined),
      getDuration: () => Promise.resolve(player.getDuration()).then(Number),
      getCurrentTime: () => Promise.resolve(player.getCurrentTime()).then(Number),
      setCurrentTime: (seconds) => Promise.resolve(player.setCurrentTime(seconds)).then((value) => Number(value ?? seconds)),
      destroy: () => { void Promise.resolve(player.destroy?.()).catch(() => undefined); },
    };
  }
  return {
    play: async () => { player.play(); },
    pause: async () => { player.pause(); },
    setMuted: async (muted) => { muted ? player.mute() : player.unmute(); },
    // Consumer API is consistently 0..1; Bunny Player.js expects 0..100.
    setVolume: async (volume) => { player.setVolume(Math.round(Math.max(0, Math.min(1, volume)) * 100)); },
    getDuration: () => bunnyCallbackNumber(player, "getDuration"),
    getCurrentTime: () => bunnyCallbackNumber(player, "getCurrentTime"),
    setCurrentTime: async (seconds) => { player.setCurrentTime(seconds); return seconds; },
    destroy: () => {
      try { player.pause(); } catch {}
      try { player.off?.("timeupdate"); player.off?.("play"); player.off?.("pause"); player.off?.("ended"); player.off?.("error"); } catch {}
    },
  };
}

export function ProviderPlayer({ source, className, testId = "video-player", renewSource, ...events }: { source: PlaybackSource; className?: string; testId?: string; renewSource?: () => Promise<PlaybackSource> } & PlayerEvents) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const eventsRef = useRef(events);
  const renewSourceRef = useRef(renewSource);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [descriptor, setDescriptor] = useState(source);
  const latestSourceRef = useRef(source);
  const [frame, setFrame] = useState(() => ({ identity: source.assetId || (source.provider === "bunny" ? `${source.libraryId}:${source.videoId}` : source.url), src: source.provider === "bunny" ? source.embedUrl || "" : normalizeVimeoEmbedUrl(source.url), generation: 0 }));
  const restoreRef = useRef<{ seconds: number; playing: boolean }>();
  const playingRef = useRef(false);
  eventsRef.current = events;
  renewSourceRef.current = renewSource;
  const identity = source.assetId || (source.provider === "bunny" ? `${source.libraryId}:${source.videoId}` : source.url);
  const nextSrc = source.provider === "bunny" ? source.embedUrl || "" : normalizeVimeoEmbedUrl(source.url);

  const replaceFrame = async (next: PlaybackSource) => {
    const adapter = adapterRef.current;
    let seconds = 0;
    if (adapter) {
      try { seconds = await adapter.getCurrentTime(); } catch {}
    }
    restoreRef.current = { seconds, playing: playingRef.current };
    const src = next.provider === "bunny" ? next.embedUrl || "" : normalizeVimeoEmbedUrl(next.url);
    if (!src) throw new Error("伺服器未提供可用的安全播放網址");
    setFrame({ identity: next.assetId || (next.provider === "bunny" ? `${next.libraryId}:${next.videoId}` : next.url), src, generation: Date.now() });
  };

  useEffect(() => {
    if (identity !== frame.identity) {
      void replaceFrame(source).catch((error) => setLoadError(error instanceof Error ? error.message : "影片更新失敗"));
      return;
    }
    // A Bunny token controls iframe admission. A refreshed descriptor for the
    // same asset is cached for recovery, but must not interrupt active playback.
    latestSourceRef.current = source;
    setDescriptor(source);
  }, [identity, nextSrc, source.expiresAt]);

  useEffect(() => {
    if (descriptor.provider !== "bunny" || !descriptor.expiresAt || !renewSourceRef.current) return;
    const delay = Math.max(0, new Date(descriptor.expiresAt).getTime() - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      renewSourceRef.current!().then((renewed) => {
        latestSourceRef.current = renewed;
        setDescriptor(renewed);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "安全播放授權更新失敗";
        if (/^(401|403|404):/.test(message)) setFrame((current) => ({ ...current, src: "" }));
        setLoadError(message);
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [descriptor.provider, descriptor.expiresAt]);

  useEffect(() => {
    let disposed = false;
    setLoadError("");
    if (!frame.src) {
      setLoadError("影片網址無效，無法安全載入");
      return;
    }
    const bunny = source.provider === "bunny";
    const scriptSrc = bunny ? "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js" : "https://player.vimeo.com/api/player.js";
    loadScript(scriptSrc, () => bunny ? !!(window as any).playerjs : !!(window as any).Vimeo).then(() => {
      if (disposed || !iframeRef.current) return;
      const rawPlayer = bunny
        ? new (window as any).playerjs.Player(iframeRef.current)
        : new (window as any).Vimeo.Player(iframeRef.current);
      const adapter = createPlayerAdapter(source.provider, rawPlayer);
      adapterRef.current = adapter;
      const bind = () => {
        rawPlayer.on("timeupdate", (data: any) => eventsRef.current.onTimeUpdate?.(Number(data.seconds ?? data.currentTime ?? 0), Number(data.duration) || undefined));
        rawPlayer.on("play", () => { playingRef.current = true; eventsRef.current.onPlay?.(); });
        rawPlayer.on("pause", () => { playingRef.current = false; eventsRef.current.onPause?.(); });
        rawPlayer.on("ended", () => eventsRef.current.onEnded?.());
        rawPlayer.on("error", () => setLoadError("影片播放發生錯誤"));
        eventsRef.current.onReady?.(adapter);
        const restore = restoreRef.current;
        restoreRef.current = undefined;
        if (restore?.seconds) void adapter.setCurrentTime(restore.seconds).then(() => restore.playing ? adapter.play() : undefined).catch(() => undefined);
      };
      if (bunny) rawPlayer.on("ready", bind); else bind();
    }).catch((error) => {
      if (!disposed) setLoadError(error instanceof Error ? error.message : "影片播放器載入失敗");
    });
    return () => {
      disposed = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [frame.identity, frame.generation, source.provider, retry]);

  return (
    <>
      {frame.src && <iframe key={frame.generation} ref={iframeRef} src={frame.src} className={className} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen data-testid={testId} />}
      {loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/90 p-4 text-center text-sm text-white" role="alert" data-testid={`${testId}-error`}>
          <p>{loadError}</p>
          <button type="button" className="rounded-md border border-white/50 px-4 py-2 font-medium hover:bg-white/10" onClick={() => { setLoadError(""); void replaceFrame(latestSourceRef.current).then(() => setRetry((value) => value + 1)).catch((error) => setLoadError(error instanceof Error ? error.message : "影片重新載入失敗")); }} data-testid={`${testId}-retry`}>重試載入</button>
        </div>
      )}
    </>
  );
}