"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// useAutoTranslate
//
// Tiny hook that powers the "type Hebrew, English fills itself" UX in
// the new-duel form and the admin custom-bet form. The caller wires
// the hook to a Hebrew input's onBlur and an English-input setter.
//
// Behaviour:
//   - Calls `/api/translate-bet-text` debounced 400ms after blur.
//   - Skips the call if the English field is already non-empty (the
//     opener / admin already wrote something; we don't clobber).
//   - Skips the call if the Hebrew input has no Hebrew characters
//     (probably already English, or empty).
//   - Surfaces { pending, error } so the caller can show a tiny
//     spinner / message beside the English field.
//   - In-flight requests are cancelled when a newer blur fires, so
//     the user can re-edit the Hebrew without two translations racing
//     the English field.
//
// Why client-side: bundling this with the form keeps the round-trip
// debounced + cancellable; server actions don't expose AbortController
// to the caller. The route handler does the auth + rate-limit.

const DEBOUNCE_MS = 400;
const HEBREW_RE = /[֐-׿]/;

export type AutoTranslateContext = "question" | "rule" | "option";

export type AutoTranslateState = {
  pending: boolean;
  error: "rate_limited" | "api_error" | "no_key" | null;
};

type Options = {
  context: AutoTranslateContext;
  // Returns the current English value at the moment we're about to
  // call. Used as a last-second guard against clobbering an already-
  // populated field (the user typed in the English while we were
  // debouncing).
  isEnglishEmpty: () => boolean;
  // Called with the translated text on success.
  onTranslate: (text: string) => void;
};

export function useAutoTranslate(opts: Options): {
  state: AutoTranslateState;
  trigger: (hebrewText: string) => void;
  cancel: () => void;
} {
  const [state, setState] = useState<AutoTranslateState>({
    pending: false,
    error: null,
  });
  // Latest opts so the debounced firing reads fresh callbacks.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (inflight.current) {
      inflight.current.abort();
      inflight.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const trigger = useCallback(
    (hebrewText: string) => {
      cancel();
      const trimmed = hebrewText.trim();
      if (trimmed.length === 0 || !HEBREW_RE.test(trimmed)) return;
      if (!optsRef.current.isEnglishEmpty()) return;

      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        if (!optsRef.current.isEnglishEmpty()) return;
        const ctrl = new AbortController();
        inflight.current = ctrl;
        setState({ pending: true, error: null });
        void fetch("/api/translate-bet-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: trimmed, context: optsRef.current.context }),
          signal: ctrl.signal,
        })
          .then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              translation?: string;
              error?: string;
            };
            if (ctrl.signal.aborted) return;
            if (body.ok && typeof body.translation === "string") {
              // Last-second re-check: caller might have typed English
              // during the round trip.
              if (optsRef.current.isEnglishEmpty()) {
                optsRef.current.onTranslate(body.translation);
              }
              setState({ pending: false, error: null });
              return;
            }
            setState({
              pending: false,
              error:
                body.error === "rate_limited"
                  ? "rate_limited"
                  : body.error === "no_key"
                    ? "no_key"
                    : "api_error",
            });
          })
          .catch((err: unknown) => {
            if (ctrl.signal.aborted) return;
            console.error("[useAutoTranslate fetch_failed]", err);
            setState({ pending: false, error: "api_error" });
          })
          .finally(() => {
            if (inflight.current === ctrl) inflight.current = null;
          });
      }, DEBOUNCE_MS);
    },
    [cancel],
  );

  return { state, trigger, cancel };
}
