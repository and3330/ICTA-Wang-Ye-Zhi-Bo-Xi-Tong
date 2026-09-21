import { ChevronDown, CreditCard, FolderOpen, LayoutDashboard, LogOut, Menu, MessageCircle, ReceiptText, ShoppingBag, Video } from "lucide-react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Props = {
  navigate: (path: string) => void;
};

export function AdminPrimaryNavigation({ navigate }: Props) {
  const [location] = useLocation();
  const actions = [
    { id: "button-webinars", label: "說明會管理", icon: Video, path: "/admin/dashboard", active: location === "/admin/dashboard" },
    { id: "button-products", label: "電商賣場管理", icon: ShoppingBag, path: "/admin/products", active: location.startsWith("/admin/products") },
    { id: "button-orders", label: "訂單管理系統", icon: ReceiptText, path: "/admin/orders", active: location.startsWith("/admin/orders") },
    { id: "button-media-library", label: "素材庫", icon: FolderOpen, path: "/admin/media", active: location.startsWith("/admin/media") },
  ];
  const openSupport = () => window.dispatchEvent(new Event("sellcase:open-support-contact"));
  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    queryClient.clear();
    navigate("/admin");
  };
  const workspaceActions = [
    { label: "回到工作台", icon: LayoutDashboard, run: () => navigate("/admin/dashboard") },
    { label: "收款設定 · 綠界", icon: CreditCard, run: () => navigate("/admin/dashboard?ecpay=1") },
    { label: "客服支援", icon: MessageCircle, run: openSupport },
  ];

  return (
    <>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="工作台主要功能">
        {actions.map(action => (
          <Button key={action.id} variant="ghost" size="sm" className={action.active ? "admin-nav-active" : ""} aria-current={action.active ? "page" : undefined} onClick={() => navigate(action.path)} data-testid={action.id}>
            <action.icon className="h-4 w-4" />{action.label}
          </Button>
        ))}
      </nav>
      <div className="mx-1 hidden h-5 border-l border-white/20 lg:block" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="admin-compact-menu hidden lg:inline-flex" data-testid="button-admin-settings">
            <Menu className="h-4 w-4" />工作台選單<ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">設定與支援</DropdownMenuLabel>
          {workspaceActions.map(action => (
            <DropdownMenuItem key={action.label} className="gap-3 py-2.5" onSelect={action.run}>
              <action.icon className="h-4 w-4" />{action.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-3 py-2.5 text-destructive focus:text-destructive" onSelect={() => void logout()}>
            <LogOut className="h-4 w-4" />登出
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="開啟工作台選單"><Menu className="h-5 w-5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {actions.map(action => (
            <DropdownMenuItem key={action.id} className={`gap-3 py-2.5 ${action.active ? "bg-accent font-semibold" : ""}`} aria-current={action.active ? "page" : undefined} onSelect={() => navigate(action.path)}>
              <action.icon className="h-4 w-4" />{action.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {workspaceActions.map(action => (
            <DropdownMenuItem key={action.label} className="gap-3 py-2.5" onSelect={action.run}>
              <action.icon className="h-4 w-4" />{action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}