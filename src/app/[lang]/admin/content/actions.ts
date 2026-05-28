"use server";

import { updateTag } from "next/cache";

import { isAdmin } from "@/lib/admin";
import {
  CONTENT_OVERRIDES_TAG,
  writeOverride,
  type SupportedLocale,
} from "@/lib/content-overrides";
import { getUser } from "@/lib/supabase/auth";

// Validation cap. Longest existing key in the dictionary today is the
// rules.liveBody paragraph at ~600 chars. 4000 is room to grow without
// letting a runaway paste blow up a row.
const MAX_VALUE_LENGTH = 4000;
const INTERPOLATION_RE = /\{[a-zA-Z0-9_]+\}/g;

// Pulls every {slot} token out of a string so the validator can compare
// the default's slot list against the new value. We never let the admin
// drop a slot - the runtime interpolation depends on it.
function extractSlots(value: string): Set<string> {
  const slots = new Set<string>();
  const matches = value.matchAll(INTERPOLATION_RE);
  for (const m of matches) {
    slots.add(m[0]);
  }
  return slots;
}

export type SaveOverrideResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "forbidden"
        | "invalid_locale"
        | "invalid_value"
        | "missing_slot"
        | "db";
      missingSlots?: string[];
    };

export type SaveOverridePayload = {
  key: string;
  locale: string;
  // Default text the editor was looking at. Used to validate that the
  // new value preserves every {slot} the default has.
  defaultValue: string;
  // `null` => reset to default (delete the row). `string` => set/update.
  newValue: string | null;
};

export async function saveOverride(
  payload: SaveOverridePayload,
): Promise<SaveOverrideResult> {
  const startedAt = Date.now();
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await isAdmin(user.id))) return { ok: false, error: "forbidden" };

  const { key, locale, defaultValue, newValue } = payload;
  if (locale !== "he" && locale !== "en") {
    console.warn("[admin content save] validation_failed", {
      key,
      reason: "invalid_locale",
    });
    return { ok: false, error: "invalid_locale" };
  }
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    console.warn("[admin content save] validation_failed", {
      key,
      reason: "invalid_key",
    });
    return { ok: false, error: "invalid_value" };
  }

  console.info("[admin content save] start", {
    key,
    locale,
    byUser: user.id,
    valueLen: newValue == null ? null : newValue.length,
  });

  if (newValue === null) {
    try {
      await writeOverride(key, locale as SupportedLocale, { type: "reset" }, user.id);
      updateTag(CONTENT_OVERRIDES_TAG);
      console.info("[admin content save] done", {
        key,
        locale,
        mode: "reset",
        durationMs: Date.now() - startedAt,
      });
      return { ok: true };
    } catch (err) {
      console.error("[admin content save] db_error", { key, locale, err });
      return { ok: false, error: "db" };
    }
  }

  if (typeof newValue !== "string") {
    return { ok: false, error: "invalid_value" };
  }
  if (newValue.length === 0 || newValue.length > MAX_VALUE_LENGTH) {
    console.warn("[admin content save] validation_failed", {
      key,
      reason: "length",
      length: newValue.length,
    });
    return { ok: false, error: "invalid_value" };
  }

  const defaultSlots = extractSlots(defaultValue);
  const newSlots = extractSlots(newValue);
  const missing: string[] = [];
  for (const slot of defaultSlots) {
    if (!newSlots.has(slot)) missing.push(slot);
  }
  if (missing.length > 0) {
    console.warn("[admin content save] validation_failed", {
      key,
      reason: "missing_slot",
      missing,
    });
    return { ok: false, error: "missing_slot", missingSlots: missing };
  }

  try {
    await writeOverride(
      key,
      locale as SupportedLocale,
      { type: "set", value: newValue },
      user.id,
    );
    updateTag(CONTENT_OVERRIDES_TAG);
    console.info("[admin content save] done", {
      key,
      locale,
      mode: "set",
      durationMs: Date.now() - startedAt,
    });
    return { ok: true };
  } catch (err) {
    console.error("[admin content save] db_error", { key, locale, err });
    return { ok: false, error: "db" };
  }
}
