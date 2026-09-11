import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import type { LangAdmin } from "@/hooks/use-lang";
import type {
  SessionRegistrationCountRow,
  SessionRegistrationCountsDto,
} from "@shared/sessionRegistrationCounts";

/**
 * Registration totals are intentionally kept separate from attendance.  A row
 * represents registrations whose selected session matches startTimeISO; null
 * startTimeISO buckets are explicitly labelled on-demand or unassigned by the
 * shared API contract.
 */
export type { SessionRegistrationCountRow, SessionRegistrationCountsDto };

type SessionRegistrationCountsProps = {
  summary?: SessionRegistrationCountsDto | null;
  lang: LangAdmin;
  compact?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
};

const copy = {
  "zh-TW": {
    title: "各場次報名",
    total: "總報名數",
    fullDb: "完整資料庫總數（非名單頁目前子集）",
    session: "場次",
    registrations: "報名數",
    time: "開始時間（台灣時間）",
    status: "狀態",
    onDemand: "隨選觀看",
    unassigned: "未選場次",
    scheduled: "已排程",
    live: "直播中",
    ended: "已結束",
    cancelled: "已取消",
    unknown: "未指定",
    empty: "尚無場次報名資料",
    loading: "正在載入各場次報名…",
    error: "各場次報名暫時無法載入",
    retry: "重試",
    showMore: "顯示全部場次",
    showLess: "收起預覽",
  },
  "zh-CN": {
    title: "各场次报名",
    total: "总报名数",
    fullDb: "完整数据库总数（非名单页当前子集）",
    session: "场次",
    registrations: "报名数",
    time: "开始时间（台湾时间）",
    status: "状态",
    onDemand: "随选观看",
    unassigned: "未选场次",
    scheduled: "已排程",
    live: "直播中",
    ended: "已结束",
    cancelled: "已取消",
    unknown: "未指定",
    empty: "尚无场次报名资料",
    loading: "正在加载各场次报名…",
    error: "各场次报名暂时无法加载",
    retry: "重试",
    showMore: "显示全部场次",
    showLess: "收起预览",
  },
} as const;

const dateFormatter = (lang: LangAdmin) => new Intl.DateTimeFormat(lang, {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatStartTime(value: string | null, lang: LangAdmin) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return dateFormatter(lang).format(date);
}

function statusLabel(status: string, lang: LangAdmin) {
  const strings = copy[lang];
  switch (String(status || "").toLowerCase()) {
    case "scheduled":
      return strings.scheduled;
    case "live":
      return strings.live;
    case "ended":
      return strings.ended;
    case "cancelled":
    case "canceled":
      return strings.cancelled;
    default:
      return status || strings.unknown;
  }
}

function sortRows(rows: SessionRegistrationCountRow[]) {
  return rows
    .map((row, index) => ({ row, index, time: row.startTimeISO ? new Date(row.startTimeISO).getTime() : Number.POSITIVE_INFINITY }))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.time) ? a.time : Number.POSITIVE_INFINITY;
      const bTime = Number.isFinite(b.time) ? b.time : Number.POSITIVE_INFINITY;
      return aTime - bTime || a.index - b.index;
    })
    .map(({ row }) => row);
}

export function SessionRegistrationCounts({
  summary,
  lang,
  compact = false,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  className,
  title,
}: SessionRegistrationCountsProps) {
  const [expanded, setExpanded] = useState(false);
  const strings = copy[lang];
  const sortedRows = useMemo(() => sortRows(summary?.counts || []), [summary?.counts]);
  const visibleRows = compact && !expanded ? sortedRows.slice(0, 3) : sortedRows;
  const hasMoreRows = compact && sortedRows.length > visibleRows.length;
  const errorMessage = error instanceof Error ? error.message : "";
  const displayTitle = title || strings.title;

  return (
    <section
      className={cn("rounded-lg border bg-card", compact ? "p-3" : "p-4", className)}
      data-testid="session-registration-counts"
      aria-label={displayTitle}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{displayTitle}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{strings.fullDb}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-bold tabular-nums", compact ? "text-xl" : "text-2xl")} data-testid="session-registration-total">
            {summary ? summary.totalRegistered.toLocaleString(lang) : "—"}
          </div>
          <div className="text-xs text-muted-foreground">{strings.total}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="session-registration-counts-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          {strings.loading}
        </div>
      ) : isError ? (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-4" data-testid="session-registration-counts-error">
          <p className="text-sm font-medium">{strings.error}</p>
          {errorMessage && <p className="mt-1 break-words text-xs text-muted-foreground">{errorMessage}</p>}
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              data-testid="button-retry-session-registration-counts"
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {strings.retry}
            </Button>
          )}
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="session-registration-counts-empty">
          {strings.empty}
        </div>
      ) : (
        <>
          <div className="mt-4 hidden max-h-[28rem] overflow-auto md:block">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">{displayTitle}</caption>
              <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-2 py-2 font-medium">{strings.time}</th>
                  <th scope="col" className="px-2 py-2 font-medium">{strings.status}</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">{strings.registrations}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const formatted = formatStartTime(row.startTimeISO, lang);
                  const isOnDemand = !formatted;
                  const label = row.labelKind === "onDemand"
                    ? strings.onDemand
                    : row.labelKind === "unassigned"
                      ? strings.unassigned
                      : formatted || strings.unknown;
                  return (
                    <tr key={row.key} className="border-b last:border-0" data-testid={`session-registration-row-${index}`}>
                      <td className="px-2 py-2.5 align-top">
                        <div className="flex items-start gap-2">
                          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>{label}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <Badge variant={row.status === "cancelled" ? "destructive" : "secondary"}>
                          {isOnDemand ? label : statusLabel(row.status, lang)}
                        </Badge>
                      </td>
                      <td className="px-2 py-2.5 text-right align-top font-bold tabular-nums">{row.registrationCount.toLocaleString(lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-2 md:hidden" role="list" aria-label={displayTitle}>
            {visibleRows.map((row, index) => {
              const formatted = formatStartTime(row.startTimeISO, lang);
              const isOnDemand = !formatted;
              const label = row.labelKind === "onDemand"
                ? strings.onDemand
                : row.labelKind === "unassigned"
                  ? strings.unassigned
                  : formatted || strings.unknown;
              return (
                <div key={row.key} className="flex items-start justify-between gap-3 rounded-md border p-3" role="listitem" data-testid={`session-registration-row-mobile-${index}`}>
                  <div className="min-w-0">
                    <div className="flex items-start gap-2 text-sm font-medium">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="break-words">{label}</span>
                    </div>
                    <Badge className="mt-2" variant={row.status === "cancelled" ? "destructive" : "secondary"}>
                      {isOnDemand ? label : statusLabel(row.status, lang)}
                    </Badge>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xl font-bold tabular-nums">{row.registrationCount.toLocaleString(lang)}</div>
                    <div className="text-xs text-muted-foreground">{strings.registrations}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMoreRows && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
              }}
              data-testid="button-show-more-session-registration-counts"
            >
              <ChevronDown className="mr-2 h-4 w-4" />
              {strings.showMore} ({sortedRows.length - visibleRows.length})
            </Button>
          )}
          {compact && expanded && sortedRows.length > 3 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 w-full"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(false);
              }}
              data-testid="button-show-less-session-registration-counts"
            >
              <ChevronUp className="mr-2 h-4 w-4" />
              {strings.showLess}
            </Button>
          )}
        </>
      )}
    </section>
  );
}