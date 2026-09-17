import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  MARKETING_CONSENT_EVENT,
  MARKETING_CONSENT_STORAGE_KEY,
  type MarketingConsent,
  parseMarketingConsent,
  readMarketingConsent,
  saveMarketingConsent,
} from "@/lib/marketing-consent";

export function useMarketingConsent() {
  const [consent, setConsent] = useState<MarketingConsent | null>(() => readMarketingConsent());

  useEffect(() => {
    const onConsent = (event: Event) => {
      setConsent((event as CustomEvent<MarketingConsent>).detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MARKETING_CONSENT_STORAGE_KEY) {
        setConsent(parseMarketingConsent(event.newValue));
      }
    };
    window.addEventListener(MARKETING_CONSENT_EVENT, onConsent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MARKETING_CONSENT_EVENT, onConsent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return consent;
}

const OPEN_SETTINGS_EVENT = "sellcase:open-marketing-consent";

/** Re-open the consent dialog from anywhere (footer link, privacy policy). */
export function openMarketingConsentSettings() {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}

export function MarketingConsentBanner() {
  const consent = useMarketingConsent();
  const [editing, setEditing] = useState(false);
  const isOpen = consent === null || editing;

  useEffect(() => {
    const onOpen = () => setEditing(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  const choose = (value: MarketingConsent) => {
    saveMarketingConsent(value);
    setEditing(false);
  };

  // Once a choice is made the dialog disappears completely; it can be
  // re-opened from the footer or the privacy policy page.
  if (!isOpen) return null;

  return (
        <section
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:bottom-5 sm:p-6"
          role="dialog"
          aria-labelledby="marketing-consent-title"
          aria-describedby="marketing-consent-description"
        >
          <h2 id="marketing-consent-title" className="text-lg font-bold">Cookie 與行銷追蹤設定</h2>
          <p id="marketing-consent-description" className="mt-2 text-sm leading-6 text-slate-600">
            必要功能不需行銷追蹤也能使用。本網站各頁面會載入 SellCase 的 Meta Pixel 以統計瀏覽成效；若您同意，我們才會進一步載入主辦人設定的 Meta Pixel 或 Google Tag Manager，並回報註冊與購買等行銷事件。相關服務商可能接收裝置、頁面與互動資料。
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            您可拒絕，之後也可透過頁尾的「隱私設定」隨時變更選擇。詳情請參閱 <Link href="/legal/privacy" className="font-semibold text-teal-700 underline">隱私權政策</Link>。
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              onClick={() => choose("denied")}
            >
              僅使用必要功能
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              onClick={() => choose("granted")}
            >
              同意行銷追蹤
            </button>
          </div>
        </section>
  );
}