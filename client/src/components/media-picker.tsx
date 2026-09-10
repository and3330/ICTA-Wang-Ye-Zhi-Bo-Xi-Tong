import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Video, Image as ImageIcon } from "lucide-react";
import type { MediaAsset } from "@/lib/media";

export function MediaPicker({
  open,
  onOpenChange,
  kind,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "video" | "image";
  onSelect: (asset: MediaAsset) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useQuery<{ assets: MediaAsset[] }>({
    queryKey: ["/api/media"],
    enabled: open,
  });
  const assets = (data?.assets || []).filter((asset) =>
    asset.kind === kind && asset.status === "ready" && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" data-testid={`dialog-${kind}-media-picker`}>
        <DialogHeader>
          <DialogTitle>{kind === "video" ? "選擇影片素材" : "選擇圖片素材"}</DialogTitle>
          <DialogDescription>只顯示已完成處理、可安全使用的自有素材。</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋素材名稱" data-testid="input-media-picker-search" />
        </div>
        {isLoading && <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {isError && <p className="py-8 text-center text-sm text-destructive" role="alert">無法讀取素材庫，請稍後再試。</p>}
        {!isLoading && !isError && assets.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">沒有符合的已就緒素材。</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {assets.map((asset) => (
            <button
              type="button"
              key={asset.id}
              className="overflow-hidden rounded-lg border text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => { onSelect(asset); onOpenChange(false); }}
              data-testid={`media-picker-item-${asset.id}`}
            >
              <div className="flex aspect-video items-center justify-center bg-muted">
                {(asset.thumbnailUrl || (asset.kind === "image" && asset.url)) ? (
                  <img src={asset.thumbnailUrl || asset.url} alt="" className="h-full w-full object-cover" />
                ) : asset.kind === "video" ? <Video className="h-8 w-8 text-muted-foreground" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
              </div>
              <div className="p-3"><p className="truncate font-medium">{asset.name}</p></div>
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => window.open("/admin/media", "_blank", "noopener,noreferrer")}>開啟素材庫上傳</Button>
      </DialogContent>
    </Dialog>
  );
}

export function VideoSourcePicker({
  vimeoUrl,
  videoAssetId,
  onChange,
}: {
  vimeoUrl: string;
  videoAssetId?: string;
  onChange: (source: { videoProvider: "vimeo" | "bunny"; vimeoUrl: string; videoAssetId?: string; durationSeconds?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const provider = videoAssetId ? "bunny" : "vimeo";
  return (
    <div className="space-y-3" data-testid="video-source-picker">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="影片來源">
        <Button type="button" variant={provider === "vimeo" ? "default" : "outline"} onClick={() => onChange({ videoProvider: "vimeo", vimeoUrl, videoAssetId: undefined })} data-testid="button-source-vimeo">Vimeo 網址</Button>
        <Button type="button" variant={provider === "bunny" ? "default" : "outline"} onClick={() => setOpen(true)} data-testid="button-source-bunny">自有影片</Button>
      </div>
      {provider === "vimeo" ? (
        <Input type="url" value={vimeoUrl} onChange={(event) => onChange({ videoProvider: "vimeo", vimeoUrl: event.target.value })} placeholder="https://vimeo.com/..." data-testid="input-source-vimeo-url" />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <span className="min-w-0 truncate text-sm font-medium">{selectedName || "已選擇自有影片"}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>更換</Button>
        </div>
      )}
      <MediaPicker open={open} onOpenChange={setOpen} kind="video" onSelect={(asset) => {
        setSelectedName(asset.name);
        onChange({ videoProvider: "bunny", vimeoUrl: "", videoAssetId: asset.id, durationSeconds: asset.durationSeconds });
      }} />
    </div>
  );
}
