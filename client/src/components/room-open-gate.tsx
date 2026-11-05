import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { ROOM_OPENS_MINUTES_BEFORE, useRoomOpenSoon } from "@/lib/room-open";

/**
 * Shows the "enter the room" button only from shortly before the start; until
 * then, a note that says when it opens and that the email has the link.
 */
export function RoomOpenGate({ start, onDemand, children, className = "" }: {
  start: string | Date | null | undefined;
  onDemand: boolean;
  children: ReactNode;
  className?: string;
}) {
  const open = useRoomOpenSoon(start, onDemand);
  if (open) return <>{children}</>;
  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground ${className}`}
      role="status"
      data-testid="room-not-open-yet"
    >
      <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>
        直播間會在開播前 {ROOM_OPENS_MINUTES_BEFORE} 分鐘開放。請保留確認信，開播時用信裡的連結就能直接進入。
      </span>
    </div>
  );
}
