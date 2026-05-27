// Public entry point for the football term glossary. Every UI surface
// that consumes an API event type, stat label, or tournament concept
// imports `t` from here.
//
// Usage:
//   import { t } from "@/lib/translations";
//   <span>{t(locale, "yellow_card")}</span>
//
// The TermKey union from ./glossary.ts makes the key argument
// compile-time checked.

import type { Locale } from "@/app/[lang]/dictionaries";
import { TERMS, type TermKey } from "./glossary";

export function t(locale: Locale, key: TermKey): string {
  return TERMS[key][locale === "he" ? "he" : "en"];
}

export type { TermKey };
