// Pluggable Internationalization Engine for Heist
// Supports instant language switching and modular locale catalogs.
// To add a new language in the future:
// 1. Create a new catalog in `src/locales/<code].ts` (e.g. `es.ts`, `fr.ts`, `de.ts`).
// 2. Call `registerLanguage(code, catalog, { name, flag })` below!

import { useEffect, useState } from "react";
import { en } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export type Language = "en" | "pt-BR" | string;

export interface LanguageMeta {
  code: Language;
  name: string;
  flag: string;
}

const STORAGE_KEY = "heist.lang";

// Registry of supported languages and translation dictionaries
const CATALOGS: Record<string, Record<string, string>> = {
  en,
  "pt-BR": ptBR,
};

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷" },
];

/**
 * Register a new language plugin dynamically.
 */
export function registerLanguage(code: string, dictionary: Record<string, string>, meta: { name: string; flag: string }) {
  CATALOGS[code] = dictionary;
  if (!SUPPORTED_LANGUAGES.some((l) => l.code === code)) {
    SUPPORTED_LANGUAGES.push({ code, name: meta.name, flag: meta.flag });
  }
}

/**
 * Get active language code from localStorage or browser preferences.
 */
export function getLanguage(): Language {
  try {
    // 1. Check URL query params (e.g. ?lang=pt or ?lang=pt-BR)
    if (typeof window !== "undefined" && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const urlLang = params.get("lang")?.toLowerCase();
      if (urlLang) {
        const match = urlLang.startsWith("pt") ? "pt-BR" : urlLang;
        if (CATALOGS[match]) {
          localStorage.setItem(STORAGE_KEY, match);
          return match;
        }
      }
    }

    // 2. Check saved preference in localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CATALOGS[saved]) return saved;

    // 3. Autodetect Brazilian Portuguese from browser
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")) {
      return "pt-BR";
    }
  } catch {
    /* fine */
  }
  return "en";
}

/**
 * Switch the active language and notify all listening components.
 */
export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    window.dispatchEvent(new CustomEvent("heist-language-change", { detail: lang }));
  } catch {
    /* fine */
  }
}

/**
 * Translate a key into the active language with optional parameter interpolation.
 * Supports:
 * - t("key")
 * - t("key", "Fallback text")
 * - t("key", { target: 3 })
 * - t("key", { target: 3 }, "Fallback text")
 */
export function t(
  key: string,
  paramsOrFallback?: Record<string, string | number> | string,
  fallback?: string,
): string {
  const lang = getLanguage();
  let text = CATALOGS[lang]?.[key] ?? CATALOGS.en?.[key];

  let params: Record<string, string | number> | undefined;
  let def = fallback;

  if (typeof paramsOrFallback === "string") {
    def = paramsOrFallback;
  } else if (paramsOrFallback && typeof paramsOrFallback === "object") {
    params = paramsOrFallback;
  }

  text = text ?? def ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }

  return text;
}

/**
 * React hook to subscribe to language changes across the application.
 */
export function useLanguage(): [Language, (lang: Language) => void] {
  const [lang, setLangState] = useState<Language>(getLanguage);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<Language>;
      if (customEvent.detail) {
        setLangState(customEvent.detail);
      } else {
        setLangState(getLanguage());
      }
    };
    window.addEventListener("heist-language-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("heist-language-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const update = (newLang: Language) => {
    setLanguage(newLang);
    setLangState(newLang);
  };

  return [lang, update];
}
