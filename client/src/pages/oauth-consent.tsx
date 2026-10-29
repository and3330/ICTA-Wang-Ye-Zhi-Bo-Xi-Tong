import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

type Webinar = {
  id: number | string;
  title: string;
  coverImage: string | null;
  status: string;
  publishStatus: string;
};

type OAuthContext = {
  client: { name: string; redirectUri: string };
  scopes: Array<{ name: string; label: string }>;
  csrfToken: string;
  consented: boolean;
  webinars: Webinar[];
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "發生未預期的錯誤，請稍後再試。";
}

function getRedirectHost(uri: string) {
  try {
    return new URL(uri).host;
  } catch {
    return "無法辨識的重新導向網址";
  }
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    live: "進行中",
    ended: "已結束",
    upcoming: "即將開始",
    scheduled: "已排程",
    cancelled: "已取消",
    published: "已發布",
    unpublished: "未發布",
    draft: "草稿",
  };
  return labels[value.toLowerCase()] ?? value;
}

export default function OAuthConsentPage() {
  const requestHandle = useMemo(() => new URLSearchParams(window.location.search).get("request") ?? "", []);
  const [context, setContext] = useState<OAuthContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"consent" | "webinar">("consent");
  const [selectedWebinar, setSelectedWebinar] = useState<string>("");
  const [working, setWorking] = useState<"consent" | "deny" | "complete" | null>(null);

  const loadContext = useCallback(async () => {
    if (!requestHandle) {
      setError("缺少授權請求識別碼，請返回應用程式重新開始連線。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setUnauthorized(false);
    try {
      const response = await fetch(`/api/oauth/requests/${encodeURIComponent(requestHandle)}`, {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `載入授權資訊失敗（${response.status}）`);
      }
      const next = await response.json() as OAuthContext;
      setContext(next);
      setStep(next.consented ? "webinar" : "consent");
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setLoading(false);
    }
  }, [requestHandle]);

  useEffect(() => { void loadContext(); }, [loadContext]);

  const consent = async () => {
    if (!context) return;
    setWorking("consent");
    setError("");
    try {
      await apiRequest("POST", `/api/oauth/requests/${encodeURIComponent(requestHandle)}/consent`, {
        csrfToken: context.csrfToken,
      });
      await loadContext();
    } catch (mutationError) {
      setError(messageFrom(mutationError));
    } finally {
      setWorking(null);
    }
  };

  const deny = async () => {
    if (!context) return;
    setWorking("deny");
    setError("");
    try {
      const response = await apiRequest("POST", `/api/oauth/requests/${encodeURIComponent(requestHandle)}/deny`, {
        csrfToken: context.csrfToken,
      });
      const result = await response.json() as { redirectUrl: string };
      window.location.assign(result.redirectUrl);
    } catch (mutationError) {
      setError(messageFrom(mutationError));
      setWorking(null);
    }
  };

  const complete = async () => {
    if (!context || !selectedWebinar) return;
    setWorking("complete");
    setError("");
    try {
      const response = await apiRequest("POST", `/api/oauth/requests/${encodeURIComponent(requestHandle)}/complete`, {
        csrfToken: context.csrfToken,
        webinarId: selectedWebinar,
      });
      const result = await response.json() as { redirectUrl: string };
      window.location.assign(result.redirectUrl);
    } catch (mutationError) {
      setError(messageFrom(mutationError));
      setWorking(null);
    }
  };

  const signInHref = `/admin?oauth_request=${encodeURIComponent(requestHandle)}`;

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-9 flex items-center justify-between gap-4">
          <Link href="/admin" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="h-5 w-5" /></span>
            <span>開賣啦 SellCase</span>
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" />安全授權
          </span>
        </header>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-muted/30 px-5 py-7 sm:px-9 sm:py-9">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">SellCase · OAuth</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">連結外部應用程式</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">請確認應用程式資訊與存取範圍，再選擇要分享的說明會。</p>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-9 sm:py-8">
            {loading && (
              <div className="space-y-4" aria-label="正在載入授權資訊" aria-busy="true">
                <div className="h-24 animate-pulse rounded-xl bg-muted" />
                <div className="h-16 animate-pulse rounded-xl bg-muted" />
                <p className="text-sm text-muted-foreground">正在安全載入授權資訊…</p>
              </div>
            )}

            {!loading && unauthorized && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                <h2 className="font-semibold">請先登入 SellCase</h2>
                <p className="mt-1 text-sm leading-6">登入後會返回這次授權流程，您可以再確認要分享的資料。</p>
                <Button asChild className="mt-4 min-h-11"><a href={signInHref}>前往登入</a></Button>
              </div>
            )}

            {!loading && error && !unauthorized && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5" role="alert">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">目前無法完成授權</h2>
                    <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{error}</p>
                    <Button variant="outline" className="mt-4 min-h-11" onClick={() => void loadContext()}>重新載入</Button>
                  </div>
                </div>
              </div>
            )}

            {!loading && context && !unauthorized && !error && (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <div className="rounded-xl border p-5">
                    <p className="text-xs font-medium text-muted-foreground">要求存取的應用程式</p>
                    <h2 className="mt-1 break-words text-xl font-semibold">{context.client.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">應用程式名稱尚未經 SellCase 驗證，請只在確認來源可信時繼續。</p>
                    <div className="mt-4 flex items-start gap-2 border-t pt-4 text-sm">
                      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">授權完成後的重新導向主機</p>
                        <p className="mt-0.5 break-all font-medium">{getRedirectHost(context.client.redirectUri)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-[150px] flex-col justify-center rounded-xl bg-primary/5 px-5 py-4 text-center">
                    <span className="text-3xl font-semibold tabular-nums">{context.scopes.length}</span>
                    <span className="mt-1 text-sm text-muted-foreground">項唯讀權限</span>
                  </div>
                </div>

                <section aria-labelledby="scope-heading" className="rounded-xl border">
                  <div className="border-b px-5 py-4">
                    <h2 id="scope-heading" className="font-semibold">應用程式可讀取</h2>
                    <p className="mt-1 text-sm text-muted-foreground">以下權限僅供讀取，不會允許應用程式修改您的資料。</p>
                  </div>
                  {context.scopes.length ? (
                    <ul className="divide-y">
                      {context.scopes.map(scope => (
                        <li key={scope.name} className="flex items-start gap-3 px-5 py-3.5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span className="text-sm leading-6">{scope.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="px-5 py-4 text-sm text-muted-foreground">此應用程式沒有要求任何資料範圍。</p>}
                </section>

                <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>聯絡資訊會依平台政策遮蔽。您可隨時在「已授權的應用」檢視或撤銷存取權。</p>
                </div>

                {step === "consent" ? (
                  <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
                    <Button variant="outline" className="min-h-11" onClick={() => void deny()} disabled={working !== null}>
                      {working === "deny" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}拒絕並返回
                    </Button>
                    <Button className="min-h-11" onClick={() => void consent()} disabled={working !== null}>
                      {working === "consent" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}同意並繼續
                    </Button>
                  </div>
                ) : (
                  <section aria-labelledby="webinar-heading" className="space-y-4 border-t pt-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">第 2 步，共 2 步</p>
                      <h2 id="webinar-heading" className="mt-1 text-xl font-semibold">選擇要連接的直播間</h2>
                      <p className="mt-1 text-sm text-muted-foreground">只能選擇一場。您可以在完成授權前返回拒絕。</p>
                    </div>
                    {context.webinars.length ? (
                      <fieldset>
                        <legend className="sr-only">選擇一場說明會</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {context.webinars.map(webinar => {
                            const id = String(webinar.id);
                            const active = selectedWebinar === id;
                            return (
                              <label key={id} className={`relative flex min-h-[120px] cursor-pointer overflow-hidden rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-ring ${active ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                                <input className="peer sr-only" type="radio" name="webinar" value={id} checked={active} onChange={() => setSelectedWebinar(id)} aria-label={`選擇說明會：${webinar.title}`} />
                                <span className={`absolute right-3 top-3 z-10 grid h-6 w-6 place-items-center rounded-full border bg-background ${active ? "border-primary bg-primary text-primary-foreground" : ""}`} aria-hidden="true">{active && <Check className="h-4 w-4" />}</span>
                                {webinar.coverImage ? (
                                  <img src={webinar.coverImage} alt={`${webinar.title}封面`} className="h-auto w-24 shrink-0 object-cover sm:w-28" />
                                ) : (
                                  <div className="grid w-24 shrink-0 place-items-center bg-muted text-xs text-muted-foreground sm:w-28">尚無封面</div>
                                )}
                                <div className="min-w-0 p-4 pr-10">
                                  <p className="line-clamp-2 font-semibold leading-5">{webinar.title}</p>
                                  <p className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                    <span className="rounded-full bg-muted px-2 py-1">{statusLabel(webinar.status)}</span>
                                    <span className="rounded-full bg-muted px-2 py-1">{statusLabel(webinar.publishStatus)}</span>
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : (
                      <Card><CardContent className="py-9 text-center">
                        <p className="font-medium">目前沒有可選擇的說明會</p>
                        <p className="mt-1 text-sm text-muted-foreground">請返回工作台建立說明會，再重新開始授權。</p>
                      </CardContent></Card>
                    )}
                    <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <Button variant="ghost" className="min-h-11 justify-start" onClick={() => void deny()} disabled={working !== null}>
                        <ArrowLeft className="mr-2 h-4 w-4" />拒絕並返回
                      </Button>
                      <Button className="min-h-11" onClick={() => void complete()} disabled={!selectedWebinar || working !== null}>
                        {working === "complete" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}完成授權
                      </Button>
                    </div>
                  </section>
                )}
                {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
              </>
            )}
          </div>
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">授權只會套用於您在此頁明確選取的說明會。</p>
      </div>
    </main>
  );
}
