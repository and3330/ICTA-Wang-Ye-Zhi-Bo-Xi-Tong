import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Keep the existing player mounted so expanding never restarts playback. */
export function FullscreenVideo({
  children,
  className,
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fullscreen = nativeFullscreen || expanded;

  useEffect(() => {
    const update = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      setNativeFullscreen((document.fullscreenElement || doc.webkitFullscreenElement) === containerRef.current);
    };
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  async function toggleFullscreen() {
    const container = containerRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | null;
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
    if (!container) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (nativeFullscreen) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } catch {
        // The browser may already have exited via its own controls.
      }
      return;
    }
    try {
      if (container.requestFullscreen) await container.requestFullscreen();
      else if (container.webkitRequestFullscreen) await container.webkitRequestFullscreen();
      else setExpanded(true);
    } catch {
      // iPhone and embedding permissions may disallow native fullscreen.
      // Expand within the available viewport instead of leaving a dead button.
      setExpanded(true);
    }
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={fullscreen ? {
        position: "fixed", inset: 0, width: "100%", height: "100dvh",
        maxWidth: "none", maxHeight: "none", aspectRatio: "auto",
        zIndex: 100, background: "black", margin: 0,
      } : undefined}
      data-testid="fullscreen-video-container"
      data-fullscreen={fullscreen}
    >
      {children}
      {enabled && (
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-40 h-11 w-11 bg-black/70 text-white hover:bg-black/90 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
          style={{ position: "absolute", zIndex: 40, top: "max(0.75rem, env(safe-area-inset-top))", right: "max(0.75rem, env(safe-area-inset-right))" }}
          aria-label={fullscreen ? "退出全螢幕" : "全螢幕放大"}
          title={fullscreen ? "退出全螢幕" : "全螢幕放大"}
          aria-pressed={fullscreen}
          onClick={() => void toggleFullscreen()}
          data-testid="button-video-fullscreen"
        >
          {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </Button>
      )}
    </div>
  );
}
