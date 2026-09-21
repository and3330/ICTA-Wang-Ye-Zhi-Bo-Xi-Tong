import { useEffect, useRef, useState } from "react";
import { ChevronRight, MessageCircle, Users, X } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const contactOptions = [
  {
    label: "開賣啦 LINE 討論社群",
    description: "加入社群，和其他使用者交流",
    href: "https://line.me/ti/g2/nr8aEvgzk5EhiMSIxRU3XynEk_eRA4hnIr6wXw?utm_source=invitation&utm_medium=link_copy&utm_campaign=default",
    icon: Users,
    iconClass: "bg-[#06c755] text-white",
  },
  {
    label: "官方 LINE 帳號",
    description: "透過 LINE 聯絡開賣啦團隊",
    href: "https://lin.ee/zUwGOFL",
    icon: MessageCircle,
    iconClass: "bg-[#06c755] text-white",
  },
  {
    label: "WhatsApp",
    description: "使用 WhatsApp 傳送訊息",
    href: "https://wa.me/85251648207",
    icon: MessageCircle,
    iconClass: "bg-[#25d366] text-white",
  },
] as const;

export function SupportContactBubble() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [location]);

  useEffect(() => {
    const openFromWorkspace = () => setOpen(true);
    window.addEventListener("sellcase:open-support-contact", openFromWorkspace);
    return () => window.removeEventListener("sellcase:open-support-contact", openFromWorkspace);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (location.startsWith("/embed/")) return null;

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6" data-testid="support-contact-widget">
      {open && (
        <section
          id="support-contact-menu"
          className="absolute bottom-[calc(100%+0.75rem)] right-0 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#b8d9d4] bg-white shadow-[0_20px_60px_rgba(9,52,64,0.24)]"
          aria-label="選擇客服聯絡方式"
          data-testid="support-contact-menu"
        >
          <div className="flex items-start justify-between gap-3 bg-[#123d59] px-4 py-4 text-white">
            <div>
              <p className="text-xs font-medium tracking-[0.14em] text-[#91ead3]">CONTACT US</p>
              <h2 className="mt-1 font-semibold">想用哪種方式聯絡我們？</h2>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-white hover:bg-white/10 hover:text-white" onClick={closeAndRestoreFocus} aria-label="關閉客服選單">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2 p-3">
            {contactOptions.map(option => (
              <a
                key={option.label}
                href={option.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-[#b8d9d4] hover:bg-[#edf8f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087f78]"
                data-testid={`support-option-${option.label === "WhatsApp" ? "whatsapp" : option.label.includes("討論") ? "line-community" : "line-official"}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${option.iconClass}`}>
                  <option.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm text-[#163d4b]">{option.label}</strong>
                  <small className="mt-0.5 block text-xs text-slate-500">{option.description}</small>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
              </a>
            ))}
          </div>
        </section>
      )}
      <Button
        ref={triggerRef}
        type="button"
        size="lg"
        className="h-14 rounded-full border border-white/20 bg-[#087f78] px-4 text-white shadow-[0_12px_32px_rgba(8,127,120,0.32)] hover:bg-[#076f69]"
        aria-expanded={open}
        aria-controls="support-contact-menu"
        aria-label={open ? "關閉客服聯絡選單" : "開啟客服聯絡選單"}
        onClick={() => setOpen(value => !value)}
        data-testid="button-support-contact"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        <span>聯絡客服</span>
      </Button>
    </div>
  );
}