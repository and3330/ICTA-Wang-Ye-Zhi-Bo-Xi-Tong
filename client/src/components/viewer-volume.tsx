import { useState, type MutableRefObject } from "react";
import { Volume2, VolumeX } from "lucide-react";

type VolumePlayer = {
  setMuted: (muted: boolean) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
};

/**
 * Mute and volume for viewers. The player's own controls stay hidden so the
 * replay still feels live (no pause or seeking); only loudness is adjustable.
 */
export function ViewerVolumeControl({
  playerRef,
  className = "",
}: {
  playerRef: MutableRefObject<VolumePlayer | null>;
  className?: string;
}) {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);

  const applyMuted = (next: boolean) => {
    setMuted(next);
    void playerRef.current?.setMuted(next).catch(() => {});
  };

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-white backdrop-blur-sm ${className}`}
      data-testid="viewer-volume"
    >
      <button
        type="button"
        onClick={() => applyMuted(!muted)}
        aria-label={muted ? "開啟聲音" : "靜音"}
        className="p-0.5"
        data-testid="button-toggle-mute"
      >
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={muted ? 0 : volume}
        aria-label="音量"
        className="hidden w-20 accent-white sm:block"
        onChange={(e) => {
          const next = Number(e.target.value);
          setVolume(next);
          if (muted && next > 0) applyMuted(false);
          void playerRef.current?.setVolume(next / 100).catch(() => {});
        }}
        data-testid="input-volume"
      />
    </div>
  );
}
