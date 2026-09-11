import { useEffect, useRef, useState } from "react";
import { Crown, FolderOpen, Languages, LogOut, Menu, MessageCircle, ShoppingBag, CreditCard, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
  const simplified = props.lang === "zh-CN";

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const actions = [
    { id: "button-products", label: "商品", icon: ShoppingBag, run: () => props.navigate("/admin/products") },
    { id: "button-orders", label: simplified ? "订单管理" : "訂單管理", icon: ReceiptText, run: () => props.navigate("/admin/orders") },
    { id: "button-media-library", label: simplified ? "素材库" : "素材庫", icon: FolderOpen, run: () => props.navigate("/admin/media") },
    { id: "button-admin-lang-toggle", label: simplified ? "简" : "繁", mobileLabel: simplified ? "切換為繁體中文" : "切换为简体中文", icon: Languages, run: props.toggleLanguage },
    ...(props.isSuperAdmin || props.canManage ? [{ id: "button-super-admin", label: props.adminLabel, icon: Crown, run: () => props.navigate("/super-admin") }] : []),
    { id: "button-open-support", label: simplified ? "客服" : "客服支援", icon: MessageCircle, run: props.openSupport, dialog: true },
    { id: "button-open-ecpay", label: simplified ? "绿界金流" : "綠界金流", icon: CreditCard, run: props.openEcpay, dialog: true },
    { id: "button-logout", label: props.logoutLabel, icon: LogOut, run: props.logout },
  ];

  return (
    <>
      <div className="hidden items-center gap-1 lg:flex" data-testid="admin-desktop-navigation">
        {actions.map(action => (
          <Button key={action.id} variant="ghost" size={action.id === "button-logout" ? "default" : "sm"} onClick={action.run} data-testid={action.id}>
            {action.id !== "button-open-ecpay" && <action.icon className="mr-1 h-4 w-4" />}
            {action.label}
          </Button>
        ))}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label={simplified ? "开启后台选单" : "開啟後台選單"} data-testid="button-admin-mobile-menu">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[min(20rem,90vw)] overflow-y-auto" onCloseAutoFocus={event => {
          if (openingDialog.current) event.preventDefault();
          openingDialog.current = false;
        }}>
          <SheetHeader className="text-left">
            <SheetTitle>{simplified ? "后台选单" : "後台選單"}</SheetTitle>
            <SheetDescription>開賣啦 SellCase</SheetDescription>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-2" aria-label={simplified ? "后台功能" : "後台功能"}>
            {actions.map(action => (
              <Button key={action.id} variant="ghost" className={`h-12 w-full justify-start gap-3 px-3 text-base ${action.id === "button-logout" ? "mt-3 border-t text-destructive" : ""}`}
                data-testid={`mobile-${action.id}`} onClick={() => {
                  openingDialog.current = "dialog" in action && action.dialog === true;
                  setOpen(false);
                  action.run();
                }}>
                <action.icon className="h-5 w-5 shrink-0" />
                {"mobileLabel" in action ? action.mobileLabel : action.label}
              </Button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}