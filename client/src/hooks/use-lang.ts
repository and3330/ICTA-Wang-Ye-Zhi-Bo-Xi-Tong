import { useState, useCallback, useEffect } from "react";

export type LangFull = "zh-TW" | "zh-CN" | "en";
export type LangAdmin = "zh-TW" | "zh-CN";

const STORAGE_KEY = "icta-lang";
const LANGUAGE_CHANGE_EVENT = "icta-language-change";

function getSavedLang(): LangFull {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-TW" || saved === "zh-CN" || saved === "en") return saved;
  return "zh-TW";
}

function getSavedAdminLang(): LangAdmin {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-TW" || saved === "zh-CN") return saved;
  if (saved === "en") return "zh-TW";
  return "zh-TW";
}

export function useLang() {
  const [lang, setLangState] = useState<LangFull>(getSavedLang);

  useEffect(() => {
    const syncLanguage = () => setLangState(getSavedLang());
    window.addEventListener("storage", syncLanguage);
    window.addEventListener(LANGUAGE_CHANGE_EVENT, syncLanguage);
    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, syncLanguage);
    };
  }, []);

  const setLang = useCallback((l: LangFull) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  }, []);

  return { lang, setLang } as const;
}

export function useAdminLang() {
  const [lang, setLangState] = useState<LangAdmin>(getSavedAdminLang);

  useEffect(() => {
    const syncLanguage = () => setLangState(getSavedAdminLang());
    window.addEventListener("storage", syncLanguage);
    window.addEventListener(LANGUAGE_CHANGE_EVENT, syncLanguage);
    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, syncLanguage);
    };
  }, []);

  const setLang = useCallback((l: LangAdmin) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  }, []);

  return { lang, setLang } as const;
}
