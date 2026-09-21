import { useEffect, useRef, useState } from "react";
import { Crown, FolderOpen, Languages, LogOut, Menu, MessageCircle, ShoppingBag, CreditCard, ReceiptText, Video, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { LangAdmin } from "@/hooks/use-lang";

type Props = {
  lang: LangAdmin;
  isSuperAdmin: boolean;
  canManage?: boolean;
  adminLabel: string;
  logoutLabel: string;
  navigate: (path: string) => void;
  toggleLanguage: () => void;
  openSupport: () => void;
  openEcpay: () => void;
  logout: () => void;
};

export function AdminDashboardNavigation(props: Props) {
  const [open, setOpen] = useState(false);
  const openingDialog = useRef(false);
  const pendingDropdownDialog = useRef<(() => void) | null>(null);
  const simplified = props.lang === "zh-CN";
  const [location] = useLocation();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const primaryActions = [
    { id: "button-webinars", label: simplified ? "说明会管理" : "說明會管理", icon: Video, run: () => props.navigate("/admin/dashboard"), active: location === "/admin/dashboard" },
    { id: "button-products", label: simplified ? "电商卖场管理" : "電商賣場管理", icon: ShoppingBag, run: () => props.navigate("/admin/products"), active: location.startsWith("/admin/products") },
    { id: "button-orders", label: simplified ? "订单管理系统" : "訂單管理系統", icon: ReceiptText, run: () => props.navigate("/admin/orders"), active: location.startsWith("/admin/orders") },
    { id: "button-media-library", label: simplified ? "素材库" : "素材庫", icon: FolderOpen, run: () => props.navigate("/admin/media") },
  ];
  const settingsActions = [
    { id: "button-open-ecpay", label: simplified ? "收款设置 · 绿界" : "收款設定 · 綠界", icon: CreditCard, run: props.openEcpay, dialog: true },
    { id: "button-open-support", label: simplified ? "客服" : "客服支援", icon: MessageCircle, run: props.openSupport, dialog: true },
    { id: "button-admin-lang-toggle", label: simplified ? "切換為繁體中文" : "切换为简体中文", icon: Languages, run: props.toggleLanguage },
  ];
  const groups = [
    { label: simplified ? "营运管理" : "營運管理", actions: primaryActions },
    { label: simplified ? "设置与支援" : "設定與支援", actions: settingsActions },
    ...(props.isSuperAdmin || props.canManage ? [{ label: "平台管理", actions: [{ id: "button-super-admin", label: props.adminLabel, icon: Crown, run: () => props.navigate("/super-admin") }] }] : []),
    { label: simplified ? "账号" : "帳號", actions: [{ id: "button-logout", label: props.logoutLabel, icon: LogOut, run: props.logout }] },
  ];
  const preventDialogFocusRestore = (event: Event) => {
    if (openingDialog.current) event.preventDefault();
    openingDialog.current = false;
  };

  return (
    <>
      <nav aria-label={simplified ? "后台主选单" : "後台主選單"} className="hidden items-center gap-1 lg:flex" data-testid="admin-desktop-navigation">
        {primaryActions.map(action => (
          <Button key={action.id} variant={action.active ? "secondary" : "ghost"} size="sm" aria-current={action.active ? "page" : undefined} onClick={action.run} data-testid={action.id}>
            <action.icon className="h-4 w-4" />
            {action.label}
          </Button>
        ))}
        <div className="mx-2 h-5 border-l border-white/20" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="admin-compact-menu" data-testid="button-admin-settings">
              <Menu className="h-4 w-4" />{simplified ? "工作台选单" : "工作台選單"}<ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={event => {
            const run = pendingDropdownDialog.current;
            if (run) {
              event.preventDefault();
              pendingDropdownDialog.current = null;
              // Let the menu release its focus scope before mounting a dialog.
              requestAnimationFrame(run);
            }
          }}>
            {groups.slice(1).map((group, index) => (
              <div key={group.label}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
                {group.actions.map(action => (
                  <DropdownMenuItem key={action.id} data-testid={action.id} className={`gap-3 py-2.5 ${action.id === "button-logout" ? "text-destructive focus:text-destructive" : ""}`} onSelect={() => {
                    if ("dialog" in action && action.dialog === true) {
                      pendingDropdownDialog.current = action.run;
                    } else {
                      action.run();
                    }
                  }}>
                    <action.icon className="h-4 w-4" />{action.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label={simplified ? "开启后台选单" : "開啟後台選單"} data-testid="button-admin-mobile-menu">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(20rem,90vw)] overflow-y-auto" onCloseAutoFocus={preventDialogFocusRestore}>
          <SheetHeader className="text-left">
            <SheetTitle>{simplified ? "后台选单" : "後台選單"}</SheetTitle>
            <SheetDescription>開賣啦 SellCase</SheetDescription>
          </SheetHeader>
          <nav className="mt-6 space-y-5" aria-label={simplified ? "后台功能" : "後台功能"}>
            {groups.map(group => <section key={group.label} aria-label={group.label}>
              <h3 className="mb-1 px-3 text-xs font-medium text-muted-foreground">{group.label}</h3>
              {group.actions.map(action => (
              <Button key={action.id} variant={"active" in action && action.active ? "secondary" : "ghost"} aria-current={"active" in action && action.active ? "page" : undefined} className={`h-11 w-full justify-start gap-3 px-3 text-sm ${action.id === "button-logout" ? "text-destructive" : ""}`}
                data-testid={`mobile-${action.id}`} onClick={() => {
                  openingDialog.current = "dialog" in action && action.dialog === true;
                  setOpen(false);
                  action.run();
                }}>
                <action.icon className="h-5 w-5 shrink-0" />
                {action.label}
              </Button>
              ))}
            </section>)}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}