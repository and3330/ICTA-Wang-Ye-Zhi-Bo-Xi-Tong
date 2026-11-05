import { apiErrorMessage } from "@/lib/viewer-messages";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Globe, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AI_KNOWLEDGE_MAX_CHARS, AI_KNOWLEDGE_MAX_SOURCES, AI_SOURCE_MAX_CHARS, type AiKnowledgeSource } from "@shared/aiAssistant";

type EditorMode = "text" | "qa" | "website" | "edit" | null;

async function multipartRequest(url: string, body: FormData) {
  const response = await fetch(url, { method: "POST", body, credentials: "include" });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()) || response.statusText}`);
  return response.json();
}

export function AiSourcesPanel({ webinarId }: { webinarId: string }) {
  const { toast } = useToast();
  const url = `/api/webinars/${webinarId}/documents`;
  const query = useQuery<AiKnowledgeSource[]>({ queryKey: [url], enabled: !!webinarId });
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<EditorMode>(null);
  const [editing, setEditing] = useState<AiKnowledgeSource | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [answer, setAnswer] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sources = query.data || [];
  const totalChars = sources.reduce((sum, source) => sum + source.content.length, 0);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle ? sources.filter(source => `${source.title} ${source.content} ${source.sourceUrl || ""}`.toLocaleLowerCase().includes(needle)) : sources;
  }, [sources, search]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [url] });
  const close = () => { setMode(null); setEditing(null); setTitle(""); setContent(""); setAnswer(""); setWebsiteUrl(""); };

  const save = useMutation({
    mutationFn: async () => {
      if (mode === "edit" && editing) {
        const response = await apiRequest("PATCH", `${url}/${editing.id}`, { title: title.trim(), content: content.trim() });
        return response.json();
      }
      if (mode === "website") {
        const response = await apiRequest("POST", `/api/webinars/${webinarId}/ai/sources/website`, { url: websiteUrl.trim(), ...(title.trim() ? { title: title.trim() } : {}) });
        return response.json();
      }
      const formatted = mode === "qa" ? `問題：${content.trim()}\n答案：${answer.trim()}` : content.trim();
      const response = await apiRequest("POST", url, { title: title.trim(), content: formatted, sourceType: mode });
      return response.json();
    },
    onSuccess: () => { refresh(); close(); toast({ title: "知識資料已儲存" }); },
    onError: (error: Error) => toast({ title: "儲存失敗", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("請選擇檔案");
      const body = new FormData();
      body.append("file", file);
      if (title.trim()) body.append("title", title.trim());
      return multipartRequest(`/api/webinars/${webinarId}/ai/sources/file`, body);
    },
    onSuccess: (result: { splitInto?: number }) => { refresh(); setFile(null); setTitle(""); if (fileInput.current) fileInput.current.value = ""; toast({ title: (result?.splitInto ?? 1) > 1 ? `檔案較長，已分成 ${result.splitInto} 筆加入知識資料` : "檔案已加入知識資料" }); },
    onError: (error: Error) => toast({ title: "上傳失敗", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${url}/${id}`),
    onSuccess: () => { refresh(); toast({ title: "知識資料已刪除" }); },
    onError: (error: Error) => toast({ title: "刪除失敗", description: apiErrorMessage(error), variant: "destructive" }),
  });
  const refreshWebsite = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/webinars/${webinarId}/ai/sources/${id}/refresh`),
    onSuccess: () => { refresh(); toast({ title: "網頁內容已更新" }); },
    onError: (error: Error) => toast({ title: "更新失敗", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const openCreate = (next: Exclude<EditorMode, "edit" | null>) => { close(); setMode(next); };
  const openEdit = (source: AiKnowledgeSource) => { close(); setEditing(source); setTitle(source.title); setContent(source.content); setMode("edit"); };
  const canSave = mode === "website" ? !!websiteUrl.trim() : mode === "qa" ? !!title.trim() && !!content.trim() && !!answer.trim() : !!title.trim() && !!content.trim();
  const typeLabel: Record<AiKnowledgeSource["sourceType"], string> = { text: "文字", qa: "問答", file: "檔案", website: "網頁", correction: "修正問答" };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>加入知識資料</CardTitle>
          <CardDescription>助理會以你的教學及產品資料為依據。單筆最多 {AI_SOURCE_MAX_CHARS.toLocaleString()} 字，最多 {AI_KNOWLEDGE_MAX_SOURCES} 筆、合計 {AI_KNOWLEDGE_MAX_CHARS.toLocaleString()} 字。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" data-testid="ai-source-add-text" onClick={() => openCreate("text")}><Plus className="mr-2 h-4 w-4" />貼上文字</Button>
            <Button variant="outline" data-testid="ai-source-add-qa" onClick={() => openCreate("qa")}><Plus className="mr-2 h-4 w-4" />新增問答</Button>
            <Button variant="outline" data-testid="ai-source-add-website" onClick={() => openCreate("website")}><Globe className="mr-2 h-4 w-4" />匯入單一網頁</Button>
          </div>
          <div className="rounded-lg border p-4">
            <Label htmlFor="ai-source-file">上傳檔案</Label>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">支援 TXT、MD、SRT、VTT。</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input aria-label="檔案標題（選填）" placeholder="自訂標題（選填）" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} />
              <Input id="ai-source-file" ref={fileInput} type="file" accept=".txt,.md,.srt,.vtt,text/plain,text/markdown" onChange={event => setFile(event.target.files?.[0] || null)} />
              <Button data-testid="ai-source-add-file" onClick={() => upload.mutate()} disabled={!file || upload.isPending}>{upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}上傳</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><CardTitle>目前的知識資料</CardTitle><CardDescription>{sources.length} 筆，共 {totalChars.toLocaleString()} 字</CardDescription></div>
            <Input className="sm:max-w-xs" aria-label="搜尋知識資料" placeholder="搜尋標題或內容" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          {query.error && <p className="text-sm text-destructive">{(query.error as Error).message}</p>}
          {!query.isLoading && !query.error && filtered.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{search ? "找不到符合的知識資料" : "尚未加入知識資料"}</p>}
          <div className="divide-y">
            {filtered.map(source => (
              <div key={source.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><p className="truncate font-medium">{source.title}</p><Badge variant="secondary">{typeLabel[source.sourceType]}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(source.updatedAt).toLocaleString("zh-TW")} · {source.content.length.toLocaleString()} 字</p>
                  {source.sourceUrl && <p className="mt-1 truncate text-xs text-muted-foreground">{source.sourceUrl}</p>}
                </div>
                <div className="flex gap-1">
                  {source.sourceType === "website" && <Button size="icon" variant="ghost" aria-label={`重新擷取 ${source.title}`} disabled={refreshWebsite.isPending} onClick={() => refreshWebsite.mutate(source.id)}><RefreshCw className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" aria-label={`檢視或編輯 ${source.title}`} onClick={() => openEdit(source)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`刪除 ${source.title}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`確定要刪除「${source.title}」？此動作無法復原。`)) remove.mutate(source.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Dialog open={mode !== null} onOpenChange={open => { if (!open) close(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{mode === "edit" ? "檢視與編輯知識資料" : mode === "qa" ? "新增常見問答" : mode === "website" ? "匯入單一網頁" : "貼上文字資料"}</DialogTitle>
            {mode === "website" && <DialogDescription>只會擷取這一頁，不會爬取整個網站。請確認你有權使用頁面內容。</DialogDescription>}</DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="source-title">標題{mode === "website" && "（選填）"}</Label><Input id="source-title" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></div>
            {mode === "website" ? <div className="space-y-2"><Label htmlFor="source-url">網站網址</Label><Input id="source-url" type="url" maxLength={2048} value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://example.com/page" /></div> :
              <div className="space-y-2"><Label htmlFor="source-content">{mode === "qa" ? "問題" : "內容"}</Label><Textarea id="source-content" rows={10} maxLength={AI_SOURCE_MAX_CHARS} value={content} onChange={event => setContent(event.target.value)} /><p className="text-right text-xs text-muted-foreground">{content.length.toLocaleString()} / {AI_SOURCE_MAX_CHARS.toLocaleString()}</p></div>}
            {mode === "qa" && <div className="space-y-2"><Label htmlFor="source-answer">答案</Label><Textarea id="source-answer" rows={7} maxLength={AI_SOURCE_MAX_CHARS - content.length - 8} value={answer} onChange={event => setAnswer(event.target.value)} /></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={close}>取消</Button><Button data-testid="ai-source-save" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}