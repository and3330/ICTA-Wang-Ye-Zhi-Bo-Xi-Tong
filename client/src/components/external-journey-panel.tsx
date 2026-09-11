import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, Eye, KeyRound, Loader2, Save, Send, ShieldAlert } from "lucide-react";
import { externalJourneySettingsSchema, type ExternalJourneySettingsInput } from "@shared/externalJourneys";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type JourneyRecord = { version: number; settings: ExternalJourneySettingsInput; publishedAt?: string | null };
type Connection = { connected: boolean; version: number | null; rotatedAt: string | null; merchantEventsPath: string; handoffExchangePath: string };
type SafeEventReceipt = { id: string; eventId: string; orderId: string; webinarId: string; amountMinor: number; currency: string; sourceTrust: "browser_reported" | "merchant_reported"; occurredAt: string };
type SafeEventResponse = { items: SafeEventReceipt[] };

const emptySettings: ExternalJourneySettingsInput = {
  landingMode: "builtin",
  thankYouMode: "builtin",
  approvedOrigins: [],
  approvedEmbedOrigins: [],
  secureHandoffEnabled: false,
  includeWatchLinkInHandoff: false,
  includeContactInHandoff: false,
};

function originsToText(origins: string[]) {
  return origins.join("\n");
}

function textToOrigins(value: string) {
  return Array.from(new Set(value.split(/\n|,/).map(origin => origin.trim()).filter(Boolean)));
}

function CodeBlock({ value, testId }: { value: string; testId: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "程式碼已複製" });
    } catch {
      toast({ title: "無法複製程式碼", variant: "destructive" });
    }
  };
  return <div className="relative">
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 pr-12 text-xs whitespace-pre-wrap break-all" data-testid={testId}>{value}</pre>
    <Button type="button" variant="outline" size="icon" className="absolute right-2 top-2 h-8 w-8" onClick={copy} aria-label="複製程式碼">
      <Copy className="h-4 w-4" />
    </Button>
  </div>;
}

/**
 * Owner-only configuration. Published settings are deliberately separate from
 * drafts: nothing in this panel changes a public route until Publish succeeds.
 */
export function ExternalJourneyPanel({ webinarId, webinarPublished }: { webinarId: string; webinarPublished: boolean }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ExternalJourneySettingsInput>(emptySettings);
  const [version, setVersion] = useState<number | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const origin = window.location.origin;
  const queryKey = ["/api/webinars", webinarId, "external-journey"];
  const journeyQuery = useQuery<JourneyRecord>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", `/api/webinars/${encodeURIComponent(webinarId)}/external-journey`)).json(),
    enabled: !!webinarId,
  });
  const connectionQuery = useQuery<Connection>({
    queryKey: ["/api/member/external-journeys/connection"],
    queryFn: async () => (await apiRequest("GET", "/api/member/external-journeys/connection")).json(),
  });
  const eventQuery = useQuery<SafeEventResponse>({
    queryKey: ["/api/member/external-journeys/events"],
    queryFn: async () => (await apiRequest("GET", "/api/member/external-journeys/events")).json(),
  });

  useEffect(() => {
    if (!journeyQuery.data) return;
    setVersion(journeyQuery.data.version);
    setSettings(externalJourneySettingsSchema.parse(journeyQuery.data.settings));
  }, [journeyQuery.data]);

  const validatedSettings = useMemo(() => externalJourneySettingsSchema.safeParse(settings), [settings]);
  const update = (patch: Partial<ExternalJourneySettingsInput>) => {
    setFormError(null);
    setSettings(current => ({ ...current, ...patch }));
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!version) throw new Error("設定尚未載入。");
      if (!validatedSettings.success) throw new Error(validatedSettings.error.issues[0]?.message || "請檢查設定");
      const response = await apiRequest("PUT", `/api/webinars/${encodeURIComponent(webinarId)}/external-journey`, { version, settings: validatedSettings.data });
      return response.json() as Promise<JourneyRecord>;
    },
    onSuccess: result => {
      setVersion(result.version);
      setSettings(result.settings);
      queryClient.setQueryData(queryKey, result);
      toast({ title: "外部旅程草稿已儲存", description: "公開連結尚未改變；請在確認後發布。" });
    },
    onError: error => setFormError(error instanceof Error ? error.message : "無法儲存設定"),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!version) throw new Error("請先儲存設定。");
      const response = await apiRequest("POST", `/api/webinars/${encodeURIComponent(webinarId)}/external-journey/publish`, { version });
      return response.json() as Promise<JourneyRecord>;
    },
    onSuccess: result => {
      setVersion(result.version);
      setSettings(result.settings);
      queryClient.setQueryData(queryKey, result);
      void queryClient.invalidateQueries({ queryKey: ["/api/webinars", webinarId, "external-journey", "public"] });
      toast({ title: "外部旅程已發布", description: "公開的行銷分享連結現在會使用這份設定。" });
    },
    onError: error => setFormError(error instanceof Error ? error.message : "無法發布設定"),
  });
  const rotate = useMutation({
    mutationFn: async () => {
      if (!window.confirm("確定要輪替整合密鑰嗎？舊密鑰會立即失效，且新密鑰只會顯示這一次。")) throw new Error("已取消輪替");
      const response = await apiRequest("POST", "/api/member/external-journeys/connection/rotate", {});
      return response.json() as Promise<{ secret: string }>;
    },
    onSuccess: result => {
      setRevealedSecret(result.secret);
      void connectionQuery.refetch();
      toast({ title: "已輪替整合密鑰", description: "請立即儲存；離開此頁後無法再次查看。" });
    },
    onError: error => {
      if (error instanceof Error && error.message === "已取消輪替") return;
      toast({ title: "無法輪替密鑰", description: error instanceof Error ? error.message : "請稍後重試", variant: "destructive" });
    },
  });

  const shareUrl = `${origin}/register/${webinarId}`;
  const formUrl = `${origin}/form/${webinarId}`;
  const embedUrl = `${origin}/embed/register/${webinarId}`;
  const sourceSnippet = `<script>\n// Your CMP must set window.sellcaseTrackingConsent = true only after optional attribution consent.\n(function () {\n  if (window.sellcaseTrackingConsent !== true) return;\n  var ref = new URLSearchParams(location.search).get("sc_ref");\n  if (!ref) return;\n  try { sessionStorage.setItem("sellcase_sc_ref", ref); }\n  catch (error) { console.debug("SellCase attribution storage unavailable", error); }\n})();\n</script>`;
  const thankYouSnippet = `<script>\n// Your CMP must set window.sellcaseTrackingConsent = true only after optional attribution consent.\n// Replace window.order fields with your trusted order-complete variables: id, amountMinor (integer), currency (ISO 4217).\n(function reportSellCaseOrder(order) {\n  if (window.sellcaseTrackingConsent !== true) return;\n  if (!order || !order.id) return;\n  var ref;\n  try { ref = new URLSearchParams(location.search).get("sc_ref") || sessionStorage.getItem("sellcase_sc_ref"); }\n  catch (error) { console.debug("SellCase attribution storage unavailable", error); return; }\n  if (!ref) return;\n  fetch("${origin}/api/external/reported?scRef=" + encodeURIComponent(ref), {\n    method: "POST", headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ scRef: ref, orderId: String(order.id), amountMinor: Number(order.amountMinor), currency: String(order.currency) })\n  }).catch(function (error) { console.debug("SellCase browser report failed", error); });\n})(window.order);\n</script>`;
  const merchantEndpoint = `${origin}${(connectionQuery.data?.merchantEventsPath || "/api/external/merchant-events/:webinarId").replace(":webinarId", webinarId)}`;
  const merchantSnippet = `// Server-side only — never put the integration secret in browser JavaScript.\nimport { createHmac } from "node:crypto";\n// For a refund, amountMinor is the cumulative refund total-to-date for this order.\nconst rawBody = JSON.stringify({ eventId, orderId, type: "purchase", amountMinor, currency, scRef, occurredAt });\nconst timestamp = Math.floor(Date.now() / 1000).toString();\nconst signature = createHmac("sha256", process.env.SELLCASE_EXTERNAL_SECRET)\n  .update(\`\${timestamp}.\${rawBody}\`).digest("hex");\nawait fetch("${merchantEndpoint}", {\n  method: "POST", headers: { "Content-Type": "application/json", "X-External-Timestamp": timestamp, "X-External-Signature": signature }, body: rawBody\n});`;
  const handoffEndpoint = `${origin}${connectionQuery.data?.handoffExchangePath || "/api/external/handoffs/exchange"}`;
  const handoffSnippet = `// Server-side only. The browser URL contains ?handoff=<opaque>; never send the secret to the browser.\nconst handoff = new URL(request.url).searchParams.get("handoff");\nif (!handoff) throw new Error("Missing SellCase handoff");\nconst response = await fetch("${handoffEndpoint}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.SELLCASE_EXTERNAL_SECRET, "X-External-Destination": "https://your-approved-site.example" },\n  body: JSON.stringify({ handoff })\n});\nif (!response.ok) throw new Error("SellCase handoff exchange failed");\nconst registration = await response.json(); // contact exists only when includeContactInHandoff was explicitly published`;

  if (journeyQuery.isLoading) return <Card><CardContent className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin" /></CardContent></Card>;
  if (journeyQuery.isError) return <Card><CardContent className="p-4 text-sm">無法載入外部旅程設定。<Button variant="ghost" className="px-1" onClick={() => journeyQuery.refetch()}>重試</Button></CardContent></Card>;

  return <div className="space-y-6" data-testid="external-journey-panel">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" />外部旅程與歸因</CardTitle>
        <CardDescription>草稿不會改變公開行為。只有「發布」會讓行銷分享連結改往已核准的外部網站。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!webinarPublished && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">此說明會尚未發布。可先儲存草稿；公開行銷入口需在說明會與這份設定都發布後才會轉址。</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>行銷落地頁</Label><Select value={settings.landingMode} onValueChange={value => update({ landingMode: value as "builtin" | "external", landingUrl: value === "builtin" ? undefined : settings.landingUrl })}><SelectTrigger data-testid="external-landing-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="builtin">使用 SellCase 落地頁</SelectItem><SelectItem value="external">使用外部網站</SelectItem></SelectContent></Select>{settings.landingMode === "external" && <Input value={settings.landingUrl || ""} onChange={event => update({ landingUrl: event.target.value })} placeholder="https://www.example.com/webinar" data-testid="external-landing-url" />}</div>
          <div className="space-y-2"><Label>報名完成頁</Label><Select value={settings.thankYouMode} onValueChange={value => update({ thankYouMode: value as "builtin" | "external", thankYouUrl: value === "builtin" ? undefined : settings.thankYouUrl })}><SelectTrigger data-testid="external-thankyou-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="builtin">使用 SellCase 成功頁</SelectItem><SelectItem value="external">使用外部完成頁</SelectItem></SelectContent></Select>{settings.thankYouMode === "external" && <Input value={settings.thankYouUrl || ""} onChange={event => update({ thankYouUrl: event.target.value })} placeholder="https://www.example.com/thanks" data-testid="external-thankyou-url" />}</div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="approved-origins">核准的網站來源</Label><Textarea id="approved-origins" value={originsToText(settings.approvedOrigins)} onChange={event => update({ approvedOrigins: textToOrigins(event.target.value) })} placeholder={"每行一個 HTTPS origin，例如\nhttps://www.example.com"} data-testid="external-approved-origins" /><p className="text-xs text-muted-foreground">僅限精確 HTTPS origin；用於外部回報的 CORS。</p></div>
          <div className="space-y-2"><Label htmlFor="approved-embed-origins">核准的嵌入父頁來源</Label><Textarea id="approved-embed-origins" value={originsToText(settings.approvedEmbedOrigins)} onChange={event => update({ approvedEmbedOrigins: textToOrigins(event.target.value) })} placeholder={"每行一個 HTTPS origin，例如\nhttps://www.example.com"} data-testid="external-approved-embed-origins" /><p className="text-xs text-muted-foreground">只有這些網站會收到嵌入表單的尺寸和成功訊息。</p></div>
        </div>
        <div className="rounded-md border p-3 space-y-3"><div className="flex items-start justify-between gap-3"><div><Label>安全報名交接</Label><p className="text-xs text-muted-foreground">外部完成頁只會收到短效、一次性的 opaque handoff，絕不含姓名、Email 或觀看 token。</p></div><Switch checked={settings.secureHandoffEnabled} onCheckedChange={secureHandoffEnabled => update({ secureHandoffEnabled, includeWatchLinkInHandoff: secureHandoffEnabled ? settings.includeWatchLinkInHandoff : false, includeContactInHandoff: secureHandoffEnabled ? settings.includeContactInHandoff : false })} data-testid="external-secure-handoff" /></div>{settings.secureHandoffEnabled && <><div className="flex items-center gap-2"><Checkbox checked={settings.includeWatchLinkInHandoff} onCheckedChange={checked => update({ includeWatchLinkInHandoff: checked === true })} id="external-watch-handoff" /><Label htmlFor="external-watch-handoff" className="text-sm">交接後允許伺服器端取得觀看連結</Label></div><div className="flex items-center gap-2"><Checkbox checked={settings.includeContactInHandoff} onCheckedChange={checked => update({ includeContactInHandoff: checked === true })} id="external-contact-handoff" data-testid="external-contact-handoff" /><Label htmlFor="external-contact-handoff" className="text-sm">交接後允許伺服器端取得姓名與 Email（預設關閉）</Label></div></>}</div>
        {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
        {!validatedSettings.success && <p className="text-sm text-destructive">{validatedSettings.error.issues[0]?.message}</p>}
        <div className="flex flex-wrap gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending || !validatedSettings.success} data-testid="external-save-draft">{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}儲存草稿</Button><Button variant="outline" onClick={() => publish.mutate()} disabled={publish.isPending || !version || !webinarPublished} data-testid="external-publish">{publish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}明確發布</Button></div>
      </CardContent>
    </Card>

    <Card><CardHeader><CardTitle className="text-base">分享與內建入口</CardTitle><CardDescription>行銷分享網址會依已發布設定轉址。表單、嵌入與觀看入口永遠保留在 SellCase。</CardDescription></CardHeader><CardContent className="space-y-3">
      <div><Label>行銷分享連結</Label><div className="mt-1 flex gap-2"><Input value={shareUrl} readOnly data-testid="external-share-link" /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(shareUrl)} aria-label="複製行銷分享連結"><Copy className="h-4 w-4" /></Button></div></div>
      <div><Label>永久內建表單（不會轉址）</Label><div className="mt-1 flex gap-2"><Input value={formUrl} readOnly data-testid="external-builtin-form-link" /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(formUrl)} aria-label="複製內建表單連結"><Copy className="h-4 w-4" /></Button></div></div>
      <div><Label>永久嵌入表單（不會轉址）</Label><div className="mt-1 flex gap-2"><Input value={embedUrl} readOnly data-testid="external-embed-link" /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(embedUrl)} aria-label="複製嵌入連結"><Copy className="h-4 w-4" /></Button></div></div>
      <p className="flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground"><Eye className="h-4 w-4 shrink-0" />私人觀看連結只會在成功報名後交付給該觀眾，不會顯示或嵌入在公開安裝碼中。</p>
    </CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" />伺服器端整合密鑰</CardTitle><CardDescription>沒有自動產生密鑰。僅在你明確輪替後顯示一次，之後僅顯示遮罩。</CardDescription></CardHeader><CardContent className="space-y-3">
      <p className="font-mono text-sm" data-testid="external-secret-status">{revealedSecret || (connectionQuery.data?.connected ? `已設定（已遮罩；第 ${connectionQuery.data.version} 版）` : "尚未建立密鑰")}</p>
      {revealedSecret && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">這是唯一一次完整顯示。請存入伺服器端環境變數，不要放入網站或瀏覽器程式碼。</p>}
      <Button variant="outline" onClick={() => rotate.mutate()} disabled={rotate.isPending} data-testid="external-rotate-secret">{rotate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}{connectionQuery.data?.connected ? "輪替密鑰" : "建立整合密鑰"}</Button>
    </CardContent></Card>

    <Card><CardHeader><CardTitle className="text-base">網站安裝與訂單回報</CardTitle><CardDescription>瀏覽器回報屬未驗證資料；商家簽名回報也不是付款供應商驗證，兩者都不會計入平台確認營收。</CardDescription></CardHeader><CardContent className="space-y-5">
      <div className="space-y-2"><Label>1. 來源捕捉碼</Label><p className="text-xs text-muted-foreground">僅在你的網站已取得 optional tracking 同意後加入，保留 opaque sc_ref。</p><CodeBlock value={sourceSnippet} testId="external-source-snippet" /></div>
      <div className="space-y-2"><Label>2. 完成頁瀏覽器回報碼</Label><p className="text-xs text-muted-foreground">請把 window.order 的示例改為你網站實際的動態 order id、amountMinor 和 currency；不含私鑰。</p><CodeBlock value={thankYouSnippet} testId="external-thankyou-snippet" /></div>
      <div className="space-y-2"><Label>3. 商家 webhook（伺服器端）</Label><p className="text-xs text-muted-foreground">使用原始 body 及 Unix timestamp 計算 HMAC SHA-256。密鑰僅放在伺服器環境變數；退款的 amountMinor 必須是該訂單截至目前的累計退款金額。此 endpoint 使用目前環境 origin，發布前請在目標環境確認。</p><CodeBlock value={merchantSnippet} testId="external-merchant-snippet" /></div>
      <div className="space-y-2"><Label>4. 安全交接交換（伺服器端）</Label><p className="text-xs text-muted-foreground">從外部完成頁 URL 讀取 opaque handoff，僅由你的伺服器以環境變數密鑰交換。瀏覽器程式碼不得使用此範例。</p><CodeBlock value={handoffSnippet} testId="external-handoff-snippet" /></div>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label>安全事件收據</Label><Button size="sm" variant="ghost" onClick={() => void eventQuery.refetch()}>重新整理</Button></div><p className="text-xs text-muted-foreground">僅顯示安全的訂單事件摘要，不包含瀏覽器 PII、原始 payload、簽章或密鑰。</p>{eventQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : eventQuery.isError ? <p className="text-sm text-destructive">無法載入事件收據。</p> : <div className="max-h-52 overflow-auto rounded-md border">{(eventQuery.data?.items || []).length ? eventQuery.data!.items.map(event => <div key={event.id} className="border-b p-2 text-xs last:border-b-0"><b>{event.orderId}</b> · {event.amountMinor} {event.currency} · {event.sourceTrust === "merchant_reported" ? "商家簽名回報（未驗證）" : "瀏覽器回報（未驗證）"}<span className="ml-2 text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span></div>) : <p className="p-3 text-xs text-muted-foreground">尚無事件收據。</p>}</div>}</div>
    </CardContent></Card>
  </div>;
}