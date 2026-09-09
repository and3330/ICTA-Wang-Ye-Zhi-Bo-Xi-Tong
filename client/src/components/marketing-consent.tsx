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

export function MarketingConsentBanner() {
  const consent = useMarketingConsent();
  const [editing, setEditing] = useState(false);
  const isOpen = consent === null || editing;

  const choose = (value: MarketingConsent) => {
    saveMarketingConsent(value);
    setEditing(false);
  };

  return (
    <>
      {isOpen && (
        <section
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:bottom-5 sm:p-6"
          role="dialog"
          aria-labelledby="marketing-consent-title"
          aria-describedby="marketing-consent-description"
        >
          <h2 id="marketing-consent-title" className="text-lg font-bold">Cookie 與行銷追蹤設定</h2>
          <p id="marketing-consent-description" className="mt-2 text-sm leading-6 text-slate-600">
            必要功能不需行銷追蹤也能使用。若您同意，我們才會載入主辦人設定的 Meta Pixel 或 Google Tag Manager，用於成效分析與行銷；相關服務商可能接收裝置、頁面與互動資料。
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            您可拒絕或隨時變更選擇。詳情請參閱 <Link href="/legal/privacy" className="font-semibold text-teal-700 underline">隱私權政策</Link>。
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
      )}
      {!isOpen && (
        <button
          type="button"
          className="fixed bottom-3 left-3 z-[99] rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          onClick={() => setEditing(true)}
          aria-label="開啟 Cookie 與行銷追蹤設定"
        >
          隱私設定
        </button>
      )}
    </>
  );
}