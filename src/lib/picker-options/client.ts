"use client";

import { useEffect, useState } from "react";
import type { MultiChoiceOption, DynamicOptionSource } from "@/lib/bets/types";
import type { Locale } from "@/app/[lang]/dictionaries";

// In-memory cache for hydrated picker option lists, keyed by
// `${source}:${locale}`. Two purposes:
//   1. Deduplicate concurrent fetches when several bet cards on the
//      same page open their picker (each one calls the hook).
//   2. Skip the network round-trip on subsequent opens within the
//      same session. The API route itself sends a 5-minute
//      Cache-Control so even a fresh tab is fast.
const cache = new Map<string, MultiChoiceOption[]>();
const inflight = new Map<string, Promise<MultiChoiceOption[]>>();

async function fetchOptions(
  source: DynamicOptionSource,
  locale: Locale,
): Promise<MultiChoiceOption[]> {
  const key = `${source}:${locale}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const t0 = Date.now();
  const promise = (async () => {
    const res = await fetch(`/api/picker-options/${source}?locale=${locale}`, {
      // Browser HTTP cache honours the response Cache-Control header,
      // so we do NOT pass cache: "no-store" here.
    });
    if (!res.ok) {
      throw new Error(
        `picker-options ${source} failed: HTTP ${res.status}`,
      );
    }
    const json = (await res.json()) as { options: MultiChoiceOption[] };
    cache.set(key, json.options);
    console.info("[bet picker hydrate]", {
      source,
      locale,
      count: json.options.length,
      ms: Date.now() - t0,
      from: "network",
    });
    return json.options;
  })();
  inflight.set(key, promise);
  promise.finally(() => inflight.delete(key));
  return promise;
}

// React hook. Returns an object with the loaded options, a loading
// flag, and the error (if any). Loads once on mount, no retries —
// the user can close + reopen the picker to retry if the network
// failed.
export function usePickerOptions(
  source: DynamicOptionSource | null,
  locale: Locale,
): {
  options: MultiChoiceOption[];
  loading: boolean;
  error: string | null;
} {
  const [options, setOptions] = useState<MultiChoiceOption[]>(() => {
    if (!source) return [];
    return cache.get(`${source}:${locale}`) ?? [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!source) return false;
    return !cache.has(`${source}:${locale}`);
  });
  const [error, setError] = useState<string | null>(null);

  // External-system sync: source/locale changes drive a fetch (or a
  // module-cache hit), and the result feeds the picker. The lint rule
  // flags every setState here but this IS the "subscribe for updates"
  // pattern from the React docs — the dependency is the prop pair, not
  // the state we're writing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!source) {
      setOptions([]);
      setLoading(false);
      return;
    }
    const key = `${source}:${locale}`;
    const cached = cache.get(key);
    if (cached) {
      setOptions(cached);
      setLoading(false);
      setError(null);
      console.info("[bet picker hydrate]", {
        source,
        locale,
        count: cached.length,
        ms: 0,
        from: "memory",
      });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOptions(source, locale).then(
      (opts) => {
        if (cancelled) return;
        setOptions(opts);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, locale]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { options, loading, error };
}
