import { useState } from "react";
import { LayoutTemplate, PanelsTopLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type SalesTemplate = "ecommerce" | "free";

export function SalesTemplateChooser({ open, onOpenChange, onChoose, pending = false }: { open: boolean; onOpenChange: (open: boolean) => void; onChoose: (template: SalesTemplate) => void; pending?: boolean }) {
  const [selected, setSelected] = useState<SalesTemplate>("ecommerce");
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>選擇成交頁起點</DialogTitle><DialogDescription>先選擇適合這項商品的版型。建立後仍可自由編輯內容，版型不會自動覆寫既有頁面。</DialogDescription></DialogHeader>
    <div className="template-choice-grid">
      <button type="button" className={`template-choice commerce ${selected === "ecommerce" ? "selected" : ""}`} disabled={pending} onClick={() => setSelected("ecommerce")} data-testid="template-choice-ecommerce">
        <span className="template-choice-icon"><PanelsTopLeft size={22} /></span><b>商品銷售頁</b><p>商品圖、名稱、價格與購買按鈕清楚並列。適合課程、下載檔與會員內容。</p><small>推薦使用</small>
      </button>
      <button type="button" className={`template-choice ${selected === "free" ? "selected" : ""}`} disabled={pending} onClick={() => setSelected("free")} data-testid="template-choice-free">
        <span className="template-choice-icon"><LayoutTemplate size={22} /></span><b>自由區塊頁</b><p>從開場、文字、圖片與方案區塊開始，依你的銷售敘事自由安排。</p><small>自由編排</small>
      </button>
    </div>
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button><Button onClick={() => onChoose(selected)} disabled={pending} data-testid="template-create-submit">建立成交頁</Button></div>
  </DialogContent></Dialog>;
}