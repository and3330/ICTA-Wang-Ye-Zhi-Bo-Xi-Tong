import { useEffect, useRef } from "react";

type AttendanceTrackingOptions = {
  registrationId?: string | null;
  watchToken?: string | null;
  enabled: boolean;
  currentPosition: number;
};

export function useAttendanceTracking({
  registrationId,
  watchToken,
  enabled,
  currentPosition,
}: AttendanceTrackingOptions) {
  const currentPositionRef = useRef(0);
  currentPositionRef.current = currentPosition;

  useEffect(() => {
    if (!enabled || !registrationId || !watchToken) return;

    let left = false;
    const body = JSON.stringify({ watchToken });
    void fetch(`/api/registrations/${encodeURIComponent(registrationId)}/attend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body,
    }).catch(() => {});

    const leave = () => {
      if (left) return;
      left = true;
      void fetch(`/api/registrations/${encodeURIComponent(registrationId)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: true,
        body: JSON.stringify({
          watchToken,
          watchDuration: Math.max(0, Math.floor(currentPositionRef.current)),
        }),
      }).catch(() => {});
    };

    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [enabled, registrationId, watchToken]);
}