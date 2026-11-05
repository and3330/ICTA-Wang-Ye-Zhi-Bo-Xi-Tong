import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { SellCaseLogo } from "@/components/sellcase-logo";

type Grant = {
  id: number | string;
  clientName: string;
  webinarTitle: string;
  webinarId: number | string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "發生未預期的錯誤，請稍後再試。";
}

export default function AuthorizedAppsPage() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Grant | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/oauth/grants", { credentials: "same-origin" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `載入已授權應用失敗（${response.status}）`);
      }
      setGrants(await response.json() as Grant[]);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadGrants(); }, [loadGrants]);

  const revoke = async () => {
    if (!selected) return;
    const id = String(selected.id);
    setRevokingId(id);
    setError("");
    setNotice("");
    try {
      await apiRequest("POST", `/api/oauth/grants/${encodeURIComponent(id)}/revoke`, {});
      const revokedAt = new Date().toISOString();
      setGrants(current => current.map(grant => String(grant.id) === id ? { ...grant, revokedAt } : grant));
      setNotice(`已撤銷「${selected.clientName}」的存取權。`);
      setSelected(null);
    } catch (revokeError) {
      setError(errorText(revokeError));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="admin-shell min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
        <div className="container mx-auto flex min-h-16 items-center justify-between gap-4 px-4">
          <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="開賣啦 SellCase 工作台">
            <SellCaseLogo className="h-auto w-[148px] sm:w-[178px]" />
          </Link>
          <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" />返回工作台
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">帳號安全</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">已授權的應用</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">管理可讀取您所選說明會資料的外部應用程式。撤銷後，該應用程式將無法再使用這項授權。</p>
          </div>
        </div>

        {notice && <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />{notice}
        </div>}
        {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium">無法完成要求</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => void loadGrants()}>重新載入</Button>
          </div>
        </div>}

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="正在載入授權清單">
            {[0, 1, 2].map(item => <div key={item} className="h-36 animate-pulse rounded-2xl border bg-card" />)}
            <p className="text-sm text-muted-foreground">正在載入授權清單…</p>
          </div>
        ) : !error && grants.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground"><ShieldCheck className="h-7 w-7" /></div>
              <h2 className="mt-5 text-lg font-semibold">尚未授權任何應用程式</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">您從外部應用程式啟動並完成授權後，授權紀錄會顯示在這裡。</p>
              <Button variant="outline" className="mt-5 min-h-11" onClick={() => void loadGrants()}>重新整理</Button>
            </CardContent>
          </Card>
        ) : !error ? (
          <section aria-label="授權應用程式清單" className="space-y-3">
            {grants.map(grant => {
              const revoked = Boolean(grant.revokedAt);
              const expired = new Date(grant.expiresAt).getTime() < Date.now();
              const inactive = revoked || expired;
              return (
                <Card key={grant.id} className={`overflow-hidden rounded-2xl ${inactive ? "opacity-80" : ""}`}>
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="break-words text-lg font-semibold">{grant.clientName}</h2>
                          {revoked ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"><XCircle className="h-3.5 w-3.5" />已撤銷</span>
                          ) : expired ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100"><Clock3 className="h-3.5 w-3.5" />已到期</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"><CheckCircle2 className="h-3.5 w-3.5" />使用中</span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">說明會：<span className="font-medium text-foreground">{grant.webinarTitle}</span></p>
                        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                          <span>授權時間：{formatDate(grant.createdAt)}</span>
                          <span>到期時間：{formatDate(grant.expiresAt)}</span>
                          {grant.revokedAt && <span>撤銷時間：{formatDate(grant.revokedAt)}</span>}
                        </div>
                        <div className="mt-4">
                          <p className="text-xs font-medium text-muted-foreground">唯讀資料範圍</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {grant.scopes.map(scope => <span key={scope} title={scope} className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs">{({ "webinars:read": "說明會資訊", "sessions:read": "場次時間", "registrations:read": "報名名單" } as Record<string, string>)[scope] || scope}</span>)}
                            {grant.scopes.length === 0 && <span className="text-xs text-muted-foreground">沒有列出資料範圍</span>}
                          </div>
                        </div>
                      </div>
                      {!inactive && <Button variant="outline" className="min-h-11 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => setSelected(grant)} disabled={revokingId !== null}>
                        <ExternalLink className="mr-2 h-4 w-4" />撤銷存取權
                      </Button>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ) : null}
      </main>

      <AlertDialog open={!!selected} onOpenChange={open => { if (!open && revokingId === null) setSelected(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤銷「{selected?.clientName}」的存取權？</AlertDialogTitle>
            <AlertDialogDescription>此應用程式將無法再讀取「{selected?.webinarTitle}」的授權資料。此操作不會刪除說明會或應用程式資料。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingId !== null}>保留授權</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={revokingId !== null} onClick={event => { event.preventDefault(); void revoke(); }}>
              {revokingId !== null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}確認撤銷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
