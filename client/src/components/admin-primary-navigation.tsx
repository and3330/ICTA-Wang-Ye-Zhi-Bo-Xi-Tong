import { FolderOpen, Menu, ReceiptText, ShoppingBag, Video } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

  return (
    <>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="工作台主要功能">
        {actions.map(action => (
          <Button key={action.id} variant={action.active ? "secondary" : "ghost"} size="sm" aria-current={action.active ? "page" : undefined} onClick={() => navigate(action.path)} data-testid={action.id}>
            <action.icon className="h-4 w-4" />{action.label}
          </Button>
        ))}
      </nav>
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
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}