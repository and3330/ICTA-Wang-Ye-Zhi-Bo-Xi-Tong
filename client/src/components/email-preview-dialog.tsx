import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/viewer-messages";

export type EmailPreviewRequest = {
  kind: "confirmation" | "reminder_24h" | "reminder_1h" | "reminder_5m" | "reminder_start" | "reminder_no_show_10m" | "followup" | "sequence";
  sequenceId?: string;
  /** Unsaved text from the settings form, so the preview matches what is typed. */
  customSubject?: string;
  customTemplate?: string;
  title: string;
};

type PreviewResult = {
  subject: string;
  html: string;
  sampleName: string;
  ctaUrl: string | null;
  links: { url: string; kind: "room" | "cta" | "other" }[];
};

/**
 * Shows an email the way a viewer receives it. The body renders in a sandboxed
 * frame (no scripts, no navigation), and every link is listed with where it goes.
 */
export function EmailPreviewDialog({
  webinarId,
  request,
  onClose,
}: {
  webinarId: string;
  request: EmailPreviewRequest | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery<PreviewResult>({
    queryKey: ["/api/webinars", webinarId, "email-preview", request],
    enabled: !!request,
    queryFn: async () => {
      const { title: _title, ...body } = request!;
      const res = await apiRequest("POST", `/api/webinars/${webinarId}/email-preview`, body);
      return res.json();
    },
  });

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>預覽：{request?.title}</DialogTitle>
          <DialogDescription>
            範例收件人「{data?.sampleName ?? "王小明"}」。實際寄出時會換成每位觀眾的名字和專屬連結。
          </DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {error && <p className="text-sm text-destructive py-6">{apiErrorMessage(error)}</p>}
        {data && (
          <div className="space-y-3">
            <div className="rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">主旨：</span>
              <span className="font-medium" data-testid="text-email-preview-subject">{data.subject || "（空白）"}</span>
            </div>
            {data.html ? (
              <iframe
                title="email preview"
                sandbox=""
                srcDoc={data.html}
                className="w-full h-[420px] rounded-md border bg-white"
                data-testid="frame-email-preview"
              />
            ) : (
              <p className="text-sm text-muted-foreground py-6">這封信目前沒有內容，不會寄出。</p>
            )}
            <div className="rounded-md bg-muted p-3 text-sm space-y-1.5">
              <p className="font-medium">信裡的連結</p>
              {data.links.length === 0 && <p className="text-muted-foreground">這封信沒有連結。</p>}
              {data.links.map((link) => (
                <div key={link.url} className="space-y-0.5">
                  <p>
                    {link.kind === "room" && "→ 直播間 / 回放：每位觀眾各自的專屬連結，點了直接進場，不用再登入。"}
                    {link.kind === "cta" && "→ 報名 / 購買頁：取自互動裡第一個有網址的 CTA 按鈕。"}
                    {link.kind === "other" && "→ 固定網址："}
                  </p>
                  {link.kind !== "room" && <p className="text-xs text-muted-foreground break-all">{link.url}</p>}
                </div>
              ))}
              {!data.ctaUrl && (
                <p className="text-xs text-amber-700 dark:text-amber-400 pt-1">
                  還沒有設定有網址的 CTA 按鈕，所以 {"{{cta_url}}"}（報名 / 購買連結）會先導到直播間。到「互動」新增一個 CTA 並填上課程報名頁網址即可。
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
