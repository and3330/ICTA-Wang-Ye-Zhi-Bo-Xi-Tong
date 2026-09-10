import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as tus from "tus-js-client";
import { ArrowLeft, Copy, Database, Eye, FileImage, Loader2, Pause, Play, RefreshCw, RotateCcw, Trash2, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatBytes, type MediaAsset, type MediaConfig, type PlaybackSource } from "@/lib/media";
import { ProviderPlayer } from "@/components/provider-player";

type UploadItem = { assetId: string; file: File; progress: number; state: "uploading" | "paused" | "failed"; error?: string; upload: tus.Upload };

export default function AdminMedia() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | "video" | "image">("all");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const [preview, setPreview] = useState<{ asset: MediaAsset; playback?: PlaybackSource }>();
  const [deleting, setDeleting] = useState<MediaAsset>();
  const [confirmMigration, setConfirmMigration] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ migrated: number; examined: number; errors?: Array<{ id?: string; name?: string; message: string }> }>();
  const { data: config } = useQuery<MediaConfig>({ queryKey: ["/api/media/config"] });
  const { data, isLoading, refetch } = useQuery<{ assets: MediaAsset[]; usage: { videoBytes: number; maxVideoBytes: number } }>({
    queryKey: ["/api/media"],
    refetchInterval: (query) => (query.state.data?.assets.some((a) => a.status === "processing" || a.status === "uploading") ? 10_000 : false),
  });

  useEffect(() => () => { uploadsRef.current.forEach((item) => void item.upload.abort()); }, []);

  const refresh = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/media/${id}/refresh`, {})).json() as Promise<MediaAsset>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/media"] }),
    onError: (error: Error) => toast({ title: "更新狀態失敗", description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/media/${id}`),
    onSuccess: () => { setDeleting(undefined); queryClient.invalidateQueries({ queryKey: ["/api/media"] }); toast({ title: "素材已刪除" }); },
    onError: (error: Error) => toast({ title: error.message.startsWith("409:") ? "素材仍被使用" : "刪除失敗", description: error.message.startsWith("409:") ? "請先從引用此素材的 Webinar 或頁面移除，再重試。" : error.message, variant: "destructive" }),
  });
  const migrateImages = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/media/migrate-images", { limit: 50 });
      return response.json() as Promise<{ migrated: number; examined: number; errors?: Array<{ id?: string; name?: string; message: string }> }>;
    },
    onSuccess: (result) => {
      setConfirmMigration(false);
      setMigrationResult(result);
      void queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    },
    onError: (error: Error) => {
      setConfirmMigration(false);
      toast({ title: "舊圖片搬移失敗", description: error.message, variant: "destructive" });
    },
  });

  const updateUpload = (assetId: string, patch: Partial<UploadItem>) => setUploads((items) => items.map((item) => item.assetId === assetId ? { ...item, ...patch } : item));
  const renewAndResume = async (item: UploadItem) => {
    try {
      const assetResponse = await apiRequest("GET", `/api/media/${item.assetId}`);
      const asset = await assetResponse.json() as MediaAsset;
      if (asset.status !== "uploading") {
        throw new Error(asset.status === "processing" ? "影片已進入處理階段，不能再次上傳。" : "影片已完成或處理失敗，不能再次上傳。");
      }
      const response = await apiRequest("POST", `/api/media/${item.assetId}/upload-authorization`, {});
      const result = await response.json() as { upload: { endpoint: string; headers: Record<string, string>; expiresAt: string } };
      item.upload.options.endpoint = result.upload.endpoint;
      item.upload.options.headers = result.upload.headers;
      updateUpload(item.assetId, { state: "uploading", error: undefined });
      item.upload.start();
    } catch (error) {
      updateUpload(item.assetId, { state: "failed", error: error instanceof Error && error.message.startsWith("409:") ? "影片已進入處理階段或處理失敗，不能再次上傳。請更新狀態。" : error instanceof Error ? error.message : "無法更新上傳授權" });
      void queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    }
  };
  const startVideo = async (file: File) => {
    if (!config?.videoEnabled) throw new Error("影片上傳目前未啟用");
    if (file.size > config.maxVideoBytes) throw new Error(`單一影片不可超過 ${formatBytes(config.maxVideoBytes)}`);
    if ((data?.usage.videoBytes || 0) + file.size > config.maxTotalVideoBytes) throw new Error("上傳後會超過會員影片總容量");
    const resumeKey = `sellcase_tus_${file.name}_${file.size}_${file.lastModified}_${file.type}`;
    let result: { asset: MediaAsset; upload: { endpoint: string; headers: Record<string, string>; expiresAt: string } };
    const existingAssetId = localStorage.getItem(resumeKey);
    if (existingAssetId) {
      try {
        const assetResponse = await apiRequest("GET", `/api/media/${existingAssetId}`);
        const asset = await assetResponse.json() as MediaAsset;
        if (asset.status !== "uploading") {
          localStorage.removeItem(resumeKey);
          throw new Error(asset.status === "processing" ? "這支影片已完成上傳並正在處理，不能重複上傳。" : asset.status === "ready" ? "這支影片已在素材庫中。" : "這支影片處理失敗，不能重新上傳到原素材。");
        }
        const authResponse = await apiRequest("POST", `/api/media/${existingAssetId}/upload-authorization`, {});
        result = { asset, upload: (await authResponse.json()).upload };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("這支影片")) throw error;
        if (!(error instanceof Error) || !error.message.startsWith("404:")) throw error;
        localStorage.removeItem(resumeKey);
        const response = await apiRequest("POST", "/api/media/videos", { name: file.name, sizeBytes: file.size, contentType: file.type || "application/octet-stream" });
        result = await response.json();
      }
    } else {
      const response = await apiRequest("POST", "/api/media/videos", { name: file.name, sizeBytes: file.size, contentType: file.type || "application/octet-stream" });
      result = await response.json();
    }
    localStorage.setItem(resumeKey, result.asset.id);
    const upload = new tus.Upload(file, {
      endpoint: result.upload.endpoint,
      headers: result.upload.headers,
      metadata: { filename: file.name, filetype: file.type || "application/octet-stream" },
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => updateUpload(result.asset.id, { progress: total ? sent / total * 100 : 0 }),
      onError: (error) => updateUpload(result.asset.id, { state: "failed", error: `${error.message}。重試時會先更新安全簽章。` }),
      onSuccess: () => {
        localStorage.removeItem(resumeKey);
        setUploads((items) => items.filter((item) => item.assetId !== result.asset.id));
        refresh.mutate(result.asset.id);
      },
    });
    const previous = await upload.findPreviousUploads();
    if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
    setUploads((items) => [...items, { assetId: result.asset.id, file, progress: 0, state: "uploading", upload }]);
    upload.start();
    queryClient.invalidateQueries({ queryKey: ["/api/media"] });
  };
  const startImage = async (file: File) => {
    if (!config?.imageEnabled) throw new Error("圖片上傳目前未啟用");
    if (file.size > config.maxImageBytes) throw new Error(`單一圖片不可超過 ${formatBytes(config.maxImageBytes)}`);
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body, credentials: "include" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "圖片上傳失敗");
    queryClient.invalidateQueries({ queryKey: ["/api/media"] });
  };
  const chooseFiles = async (files: FileList | null) => {
    for (const file of Array.from(files || [])) {
      try {
        if (file.type.startsWith("video/")) await startVideo(file);
        else if (file.type.startsWith("image/")) await startImage(file);
        else throw new Error("只支援影片與圖片檔案");
      } catch (error) {
        toast({ title: "上傳失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };
  const openPreview = async (asset: MediaAsset) => {
    if (asset.kind === "image") return setPreview({ asset });
    try {
      const response = await apiRequest("GET", `/api/media/${asset.id}/playback`);
      setPreview({ asset, playback: { ...(await response.json()), assetId: asset.id } });
    } catch (error) {
      toast({ title: "無法預覽影片", description: error instanceof Error ? error.message : "", variant: "destructive" });
    }
  };
  const assets = (data?.assets || []).filter((asset) => filter === "all" || asset.kind === filter);
  const usageMax = data?.usage.maxVideoBytes || config?.maxTotalVideoBytes || 0;

  return (
    <div className="min-h-screen bg-muted/20" data-testid="admin-media-page">
      <header className="sticky top-0 z-40 border-b bg-background"><div className="container mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-4">
        <div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => setLocation("/admin/dashboard")} aria-label="返回控制台"><ArrowLeft /></Button><div><h1 className="text-xl font-bold">媒體素材庫</h1><p className="text-xs text-muted-foreground">管理 Bunny 影片與圖片</p></div></div>
        <Button onClick={() => inputRef.current?.click()} disabled={!config?.videoEnabled && !config?.imageEnabled} data-testid="button-media-upload"><Upload className="mr-2 h-4 w-4" />上傳素材</Button>
        <input ref={inputRef} hidden multiple type="file" accept="video/*,image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void chooseFiles(event.target.files)} data-testid="input-media-upload" />
      </div></header>
      <main className="container mx-auto space-y-5 px-4 py-6">
        {config && config.videoEnabled && config.playbackEnabled === false && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status" data-testid="media-playback-setup-notice">
            影片可上傳，但安全播放尚未設定。管理員需設定獨立的 Bunny Stream 播放 Token Key；系統不會改用未簽章網址。
          </div>
        )}
        <Card><CardContent className="space-y-2 p-4"><div className="flex justify-between gap-2 text-sm"><span>影片容量</span><strong data-testid="text-media-usage">{formatBytes(data?.usage.videoBytes || 0)} / {formatBytes(usageMax)}</strong></div><Progress value={usageMax ? (data?.usage.videoBytes || 0) / usageMax * 100 : 0} /><p className="text-xs text-muted-foreground">單一影片上限 {formatBytes(config?.maxVideoBytes || 0)}；單一圖片上限 {formatBytes(config?.maxImageBytes || 0)}；每位會員總影片容量 {formatBytes(config?.maxTotalVideoBytes || 0)}。</p></CardContent></Card>
        {uploads.map((item) => <Card key={item.assetId} data-testid={`media-upload-${item.assetId}`}><CardContent className="space-y-3 p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{item.file.name}</p><p className="text-xs text-muted-foreground" data-testid={`media-upload-status-${item.assetId}`}>{item.state === "failed" ? item.error : item.state === "paused" ? "已暫停，可繼續上傳" : "上傳中"}</p></div><span className="font-mono text-sm">{Math.round(item.progress)}%</span></div><Progress value={item.progress} /><div className="flex flex-wrap gap-2">{item.state === "uploading" && <Button size="sm" variant="outline" onClick={async () => { await item.upload.abort(); updateUpload(item.assetId, { state: "paused" }); }} data-testid={`button-upload-pause-${item.assetId}`}><Pause className="mr-1 h-4 w-4" />暫停</Button>}{item.state === "paused" && <Button size="sm" onClick={() => void renewAndResume(item)} data-testid={`button-upload-resume-${item.assetId}`}><Play className="mr-1 h-4 w-4" />繼續</Button>}{item.state === "failed" && <Button size="sm" onClick={() => void renewAndResume(item)} data-testid={`button-upload-retry-${item.assetId}`}><RotateCcw className="mr-1 h-4 w-4" />重試</Button>}<Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await item.upload.abort(true); setUploads((items) => items.filter((current) => current.assetId !== item.assetId)); try { await apiRequest("DELETE", `/api/media/${item.assetId}`); } catch {} void queryClient.invalidateQueries({ queryKey: ["/api/media"] }); }} data-testid={`button-upload-cancel-${item.assetId}`}><Trash2 className="mr-1 h-4 w-4" />取消上傳</Button></div></CardContent></Card>)}
        <div className="flex flex-wrap items-center justify-between gap-3"><Select value={filter} onValueChange={(value: typeof filter) => setFilter(value)}><SelectTrigger className="w-40" data-testid="select-media-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部素材</SelectItem><SelectItem value="video">影片</SelectItem><SelectItem value="image">圖片</SelectItem></SelectContent></Select><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setConfirmMigration(true)} disabled={!config?.imageEnabled || migrateImages.isPending} data-testid="button-migrate-legacy-images"><Database className="mr-2 h-4 w-4" />搬移舊圖片</Button><Button variant="outline" onClick={() => void refetch()}><RefreshCw className="mr-2 h-4 w-4" />重新整理</Button></div></div>
        {isLoading ? <Loader2 className="mx-auto h-7 w-7 animate-spin" /> : assets.length === 0 ? <p className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">尚無素材</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{assets.map((asset) => <Card key={asset.id} data-testid={`media-asset-${asset.id}`}><div className="flex aspect-video items-center justify-center overflow-hidden rounded-t-lg bg-muted">{asset.thumbnailUrl || (asset.kind === "image" && asset.url) ? <img src={asset.thumbnailUrl || asset.url} alt="" className="h-full w-full object-cover" /> : asset.kind === "video" ? <Video className="h-9 w-9 text-muted-foreground" /> : <FileImage className="h-9 w-9 text-muted-foreground" />}</div><CardContent className="space-y-3 p-4"><div><p className="truncate font-semibold">{asset.name}</p><p className="text-xs text-muted-foreground">{formatBytes(asset.sizeBytes)} · <span data-testid={`media-status-${asset.id}`}>{asset.status === "ready" ? "已就緒" : asset.status === "processing" ? "處理中" : asset.status === "failed" ? "處理失敗" : "上傳中"}</span></p></div><div className="flex flex-wrap gap-2">{asset.status === "ready" && <Button size="sm" variant="outline" onClick={() => void openPreview(asset)}><Eye className="mr-1 h-4 w-4" />預覽</Button>}{asset.kind === "image" && asset.url && <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(asset.url!); toast({ title: "圖片網址已複製" }); }} data-testid={`button-copy-media-url-${asset.id}`}><Copy className="mr-1 h-4 w-4" />複製網址</Button>}{asset.kind === "video" && (asset.status === "processing" || asset.status === "failed") && <Button size="sm" variant="outline" onClick={() => refresh.mutate(asset.id)} disabled={refresh.isPending}><RefreshCw className="mr-1 h-4 w-4" />更新狀態</Button>}<Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(asset)} data-testid={`button-delete-media-${asset.id}`}><Trash2 className="mr-1 h-4 w-4" />刪除</Button></div></CardContent></Card>)}</div>}
      </main>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(undefined)}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{preview?.asset.name}</DialogTitle></DialogHeader><div className="relative aspect-video overflow-hidden rounded-md bg-black">{preview?.asset.kind === "image" ? <img src={preview.asset.url} alt={preview.asset.name} className="h-full w-full object-contain" /> : preview?.playback ? <ProviderPlayer source={preview.playback} className="h-full w-full" testId="media-owner-preview" renewSource={async () => { const response = await apiRequest("GET", `/api/media/${preview.asset.id}/playback`); return { ...(await response.json()), assetId: preview.asset.id }; }} /> : null}</div></DialogContent></Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(undefined)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>刪除此素材？</AlertDialogTitle><AlertDialogDescription>此動作無法復原。若素材仍被 Webinar 或頁面引用，伺服器會拒絕刪除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)} data-testid="button-confirm-delete-media">確認刪除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={confirmMigration} onOpenChange={(open) => !migrateImages.isPending && setConfirmMigration(open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>將舊圖片複製到 Bunny？</AlertDialogTitle><AlertDialogDescription>系統會複製並逐一驗證最多 50 張屬於你的舊圖片。原始檔案與既有網址都會保留，不會刪除或改寫；只有驗證成功的副本才會改由 Bunny 提供。此操作不會自動執行。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={migrateImages.isPending}>取消</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); migrateImages.mutate(); }} disabled={migrateImages.isPending} data-testid="button-confirm-migrate-legacy-images">{migrateImages.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}確認搬移</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Dialog open={!!migrationResult} onOpenChange={(open) => !open && setMigrationResult(undefined)}><DialogContent data-testid="dialog-migration-result"><DialogHeader><DialogTitle>舊圖片搬移結果</DialogTitle></DialogHeader>{migrationResult && <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">已檢查</p><strong className="text-2xl" data-testid="text-migration-examined">{migrationResult.examined}</strong></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">成功搬移</p><strong className="text-2xl" data-testid="text-migration-count">{migrationResult.migrated}</strong></div></div>{migrationResult.examined > migrationResult.migrated && !migrationResult.errors?.length && <p className="text-sm text-amber-700" role="status">有 {migrationResult.examined - migrationResult.migrated} 張未能搬移；伺服器未提供逐檔錯誤詳情，原始檔案維持不變。</p>}{migrationResult.errors?.length ? <div><p className="mb-2 text-sm font-medium">未搬移項目</p><ul className="max-h-48 space-y-2 overflow-y-auto text-sm" data-testid="list-migration-errors">{migrationResult.errors.map((error, index) => <li key={error.id || `${error.name}-${index}`} className="rounded-md bg-destructive/10 p-2"><strong>{error.name || error.id || `項目 ${index + 1}`}</strong><span className="ml-2 text-muted-foreground">{error.message}</span></li>)}</ul></div> : null}<p className="text-xs text-muted-foreground">所有原始檔案及原網址均已保留。</p><Button className="w-full" onClick={() => setMigrationResult(undefined)}>完成</Button></div>}</DialogContent></Dialog>
    </div>
  );
}