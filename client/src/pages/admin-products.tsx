import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink, FilePlus2, Loader2, Package, Pencil, Plus, ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SalesTemplateChooser, type SalesTemplate } from "@/components/sales-template-chooser";
import { createSalesPageTemplate } from "@shared/salesPageTemplates";

type Product = { id: string; name: string; amountMinor: number | null; currency: string; paymentProvider: string; ecpayItemName?: string | null; ecpayAmountTwd?: number | null; active: boolean; webinarId?: string | null; salesPage?: ProductPage | null };
type ProductPage = { id: string; offerId: string; slug: string; title: string; status: "draft" | "published"; version: number };
type Order = { id: string; amountMinor: number; currency: string; status: string; createdAt: string; purchasedAt?: string | null; webinarId?: string | null; source: "webinar" | "direct" };

const money = (minor: number, currency: string) => new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: currency === "TWD" ? 0 : 2 }).format(minor / 100);
export default function AdminProducts() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Product | null | "new">(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [ordersFor, setOrdersFor] = useState<Product | null>(null);
  const [templateFor, setTemplateFor] = useState<Product | null>(null);
  const productsQuery = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const pagesQuery = useQuery<ProductPage[]>({ queryKey: ["/api/product-sales-pages"] });
  const ordersQuery = useQuery<Order[]>({ queryKey: ["/api/products", ordersFor?.id, "orders"], enabled: !!ordersFor });
  const pagesByOffer = useMemo(() => new Map((pagesQuery.data || []).map(page => [page.offerId, page])), [pagesQuery.data]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/product-sales-pages"] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const amountTwd = Number(amount);
      if (!name.trim() || !Number.isInteger(amountTwd) || amountTwd <= 0) throw new Error("請輸入商品名稱與大於 0 的新台幣整數價格。");
      const response = editing === "new"
        ? await apiRequest("POST", "/api/products", { name: name.trim(), amountTwd })
        : await apiRequest("PATCH", `/api/products/${editing!.id}`, { name: name.trim(), amountTwd });
      return response.json();
    },
    onSuccess: (saved: Product) => {
      queryClient.setQueryData<Product[]>(["/api/products"], current => editing === "new"
        ? [saved, ...(current || [])]
        : (current || []).map(product => product.id === saved.id ? { ...product, ...saved } : product));
      refresh(); setEditing(null); toast({ title: "商品已儲存" });
    },
    onError: (error: Error) => toast({ title: "無法儲存商品", description: error.message, variant: "destructive" }),
  });
  const toggleArchive = useMutation({
    mutationFn: async (product: Product) => product.active
      ? apiRequest("DELETE", `/api/products/${product.id}`)
      : apiRequest("PATCH", `/api/products/${product.id}`, { active: true }),
    onSuccess: () => { refresh(); toast({ title: "商品狀態已更新" }); },
    onError: (error: Error) => toast({ title: "操作失敗", description: error.message, variant: "destructive" }),
  });
  const createPage = useMutation({
    mutationFn: async ({ product, template }: { product: Product; template: SalesTemplate }) => {
      const slug = `product-${product.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const response = await apiRequest("POST", "/api/product-sales-pages", { offerId: product.id, slug, title: `${product.name} 商品頁`, template, blocks: createSalesPageTemplate(template, { name: product.name }) });
      return response.json() as Promise<ProductPage>;
    },
    onSuccess: page => { refresh(); navigate(`/admin/products/sales/${page.id}`); },
    onError: (error: Error) => toast({ title: "建立商品頁失敗", description: error.message, variant: "destructive" }),
  });
  const pageAction = useMutation({
    mutationFn: async ({ page, action }: { page: ProductPage; action: "publish" | "unpublish" }) => {
      const response = await apiRequest("POST", `/api/product-sales-pages/${page.id}/${action}`, { version: page.version });
      return response.json();
    },
    onSuccess: () => { refresh(); toast({ title: "商品頁狀態已更新" }); },
    onError: (error: Error) => toast({ title: "操作失敗", description: error.message, variant: "destructive" }),
  });
  const deletePage = useMutation({
    mutationFn: (page: ProductPage) => apiRequest("DELETE", `/api/product-sales-pages/${page.id}`),
    onSuccess: () => { refresh(); toast({ title: "商品頁已刪除" }); },
    onError: (error: Error) => toast({ title: "刪除失敗", description: error.message, variant: "destructive" }),
  });
  const openEdit = (product?: Product) => {
    setEditing(product || "new");
    setName(product?.name || "");
    setAmount(product?.amountMinor == null ? "" : String(product.amountMinor / 100));
  };
  const products = productsQuery.data || [];
  return <div className="admin-shell min-h-screen bg-muted/30">
    <header className="sticky top-0 z-20 border-b bg-card"><div className="container mx-auto flex items-center gap-3 px-4 py-4">
      <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")} aria-label="返回控制台"><ArrowLeft /></Button>
      <SellCaseLogo className="h-auto w-[145px]" /><div className="ml-auto"><Button onClick={() => openEdit()}><Plus className="mr-2 h-4 w-4" />建立商品</Button></div>
    </div></header>
    <main className="container mx-auto space-y-6 px-4 py-8">
      <div><h1 className="text-2xl font-bold">商品與獨立銷售頁</h1><p className="mt-1 text-sm text-muted-foreground">不需要建立直播，也能販售商品、建立公開銷售頁並查看訂單。</p></div>
      <Card><CardContent className="p-4 text-sm text-muted-foreground"><b className="text-foreground">數位商品直接付款</b>：SellCase 不提供購物車、庫存或物流配送。付款會導向你設定的綠界 ECPay 商店；請先到 <button className="font-semibold text-teal-700 underline" onClick={() => navigate("/admin/dashboard?ecpay=1")}>控制台設定會員綠界金流</button>。</CardContent></Card>
      {productsQuery.isLoading ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin" /></div> : products.length === 0 ? <Card><CardContent className="py-16 text-center"><Package className="mx-auto mb-3 text-muted-foreground" /><b>還沒有商品</b><p className="my-2 text-sm text-muted-foreground">先建立第一項商品，無需直播即可開始。</p><Button onClick={() => openEdit()}>建立商品</Button></CardContent></Card> :
      <div className="grid gap-4 lg:grid-cols-2">{products.map(product => {
        const page = pagesByOffer.get(product.id) || product.salesPage;
        return <Card key={product.id} className={!product.active ? "opacity-70" : ""}><CardHeader><div className="flex items-start justify-between gap-2"><div><h2 className="text-lg font-semibold leading-none tracking-tight">{product.name}</h2><p className="mt-1 font-semibold text-teal-700">{product.amountMinor == null ? "價格無法取得" : money(product.amountMinor, product.currency)}</p></div><Badge variant={product.active ? "default" : "secondary"}>{product.active ? "販售中" : "已封存"}</Badge></div></CardHeader><CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">{product.paymentProvider === "ecpay" && <Button size="sm" variant="outline" onClick={() => openEdit(product)}><Pencil className="mr-1 h-4 w-4" />編輯</Button>}<Button size="sm" variant="outline" onClick={() => setOrdersFor(product)}><ReceiptText className="mr-1 h-4 w-4" />訂單</Button><Button size="sm" variant="ghost" onClick={() => toggleArchive.mutate(product)}>{product.active ? <Trash2 className="mr-1 h-4 w-4" /> : <RotateCcw className="mr-1 h-4 w-4" />}{product.active ? "封存" : "恢復"}</Button></div>
          <div className="rounded-lg border p-3">{page ? <><div className="flex items-center justify-between"><b className="text-sm">{page.title}</b><Badge variant="outline">{page.status === "published" ? "已發布" : "草稿"}</Badge></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => navigate(`/admin/products/sales/${page.id}`)}>編輯／預覽</Button><Button size="sm" variant="outline" onClick={() => pageAction.mutate({ page, action: page.status === "published" ? "unpublish" : "publish" })}>{page.status === "published" ? "取消發布" : "發布"}</Button>{page.status === "published" && <><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(`${location.origin}/sales/${page.slug}`)}><Copy className="mr-1 h-4 w-4" />複製網址</Button><Button size="icon" variant="ghost" onClick={() => window.open(`/sales/${page.slug}`, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" /></Button></>}<Button size="icon" variant="ghost" aria-label="刪除商品頁" onClick={() => window.confirm("確定刪除這個商品頁？") && deletePage.mutate(page)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></> : <Button size="sm" variant="outline" disabled={!product.active || createPage.isPending} onClick={() => setTemplateFor(product)}><FilePlus2 className="mr-1 h-4 w-4" />建立商品頁</Button>}</div>
          </CardContent></Card>;
      })}</div>}
    </main>
    <SalesTemplateChooser open={!!templateFor} onOpenChange={open => !open && setTemplateFor(null)} pending={createPage.isPending} onChoose={template => templateFor && createPage.mutate({ product: templateFor, template })} />
    <Dialog open={editing !== null} onOpenChange={open => !open && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>{editing === "new" ? "建立商品" : "編輯商品"}</DialogTitle><DialogDescription>價格須為大於 0 的新台幣整數，公開頁一律顯示後端商品價格。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}><div><Label htmlFor="product-name">商品名稱</Label><Input id="product-name" className="mt-2" value={name} maxLength={200} onChange={e => setName(e.target.value)} required /></div><div><Label htmlFor="product-amount-twd">價格（TWD）</Label><Input id="product-amount-twd" className="mt-2" type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} required /></div><Button className="w-full" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button></form></DialogContent></Dialog>
    <Dialog open={!!ordersFor} onOpenChange={open => !open && setOrdersFor(null)}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{ordersFor?.name}・訂單</DialogTitle><DialogDescription>每筆訂單都會標示成交來源；付款金額與狀態以後端紀錄為準。</DialogDescription></DialogHeader>{ordersQuery.isLoading ? <Loader2 className="mx-auto animate-spin" /> : (ordersQuery.data || []).length === 0 ? <p className="py-8 text-center text-muted-foreground">尚無訂單</p> : <div className="space-y-2">{ordersQuery.data!.map(order => <div key={order.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-3 text-sm"><div><b>{money(order.amountMinor, order.currency)}</b><p className="text-xs text-muted-foreground">{new Date(order.purchasedAt || order.createdAt).toLocaleString("zh-TW")} · <span>{order.source === "direct" ? "獨立商品頁" : "直播"}</span></p></div><Badge variant={order.status === "paid" ? "default" : "outline"}>{order.status}</Badge></div>)}</div>}</DialogContent></Dialog>
  </div>;
}