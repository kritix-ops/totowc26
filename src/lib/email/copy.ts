import "server-only";

import { getDictionary, type Locale } from "@/app/[lang]/dictionaries";

// Token substitution for email copy. Defaults live in he.json /
// en.json under `emails.*` and may be overridden by the admin from
// /admin/content. Each template string can reference values like
// {playerName}, {stake} - this helper swaps them at render time.
//
// Missing keys leave the literal `{key}` in place. Saves us from
// silently dropping a slot the admin accidentally removed (the
// /admin/content validator already blocks that on save, but we keep
// the fallback explicit so a future bug doesn't render an empty
// string into the email body).
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    return values[key] !== undefined ? String(values[key]) : `{${key}}`;
  });
}

// Loads the dictionary in the language the recipient sees the email
// in. All transactional emails are Hebrew-only today, but the dict has
// both languages so a future "user.preferredLocale" hook plugs in here
// with zero template changes.
export async function getEmailCopy(locale: Locale = "he") {
  const dict = await getDictionary(locale);
  return dict.emails;
}

export type EmailCopy = Awaited<ReturnType<typeof getEmailCopy>>;
