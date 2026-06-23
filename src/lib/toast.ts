// App-wide toast store. Module singleton (sonner-style): any client
// component can `import { toast } from "@/lib/toast"` and fire one, and the
// single <Toaster /> mounted in the root layout renders the stack. No
// context provider wraps the tree — same lightweight approach the existing
// HiddenPageToast uses, just centralized so every save can route through it.
//
// Design rules (from _plans/2026-06-17-automatic-save-everywhere.md):
//  - success / info auto-expire; ERRORS are sticky by default (duration 0)
//    so a failed save can never silently scroll away. Callers that want a
//    retry affordance pass an `action`.
//  - getToasts() returns a STABLE array reference between mutations so the
//    useSyncExternalStore read in <Toaster /> doesn't loop.
//  - the stack is capped so a burst of saves can't bury the screen.

export type ToastKind = "success" | "error" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 = sticky (dismissed by tap / retry only). */
  duration: number;
};

type Listener = () => void;

type ShowOptions = {
  action?: ToastAction;
  /** Override the default duration. 0 makes the toast sticky. */
  duration?: number;
};

// Errors stay until acknowledged; success/info clear themselves. A failed
// save being loud and persistent is the whole point — the user must not be
// able to walk away thinking it saved.
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 4500,
  error: 0,
};

// Most toasts on screen at once. A rapid run of saves trims the oldest so
// the stack never grows past a glanceable size on a phone.
const MAX_TOASTS = 3;

let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function scheduleDismiss(id: number, duration: number) {
  if (duration <= 0) return;
  timers.set(
    id,
    setTimeout(() => dismissToast(id), duration),
  );
}

function clearTimer(id: number) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number): void {
  clearTimer(id);
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return; // already gone
  toasts = next;
  emit();
}

function show(kind: ToastKind, message: string, opts?: ShowOptions): number {
  const id = ++nextId;
  const duration = opts?.duration ?? DEFAULT_DURATION[kind];
  const toast: Toast = { id, kind, message, action: opts?.action, duration };
  // Append, then trim the oldest beyond the cap (and cancel its timer so a
  // late dismiss can't fire against an id that's already gone).
  const combined = [...toasts, toast];
  while (combined.length > MAX_TOASTS) {
    const dropped = combined.shift();
    if (dropped) clearTimer(dropped.id);
  }
  toasts = combined;
  emit();
  scheduleDismiss(id, duration);
  return id;
}

export const toast = {
  success: (message: string, opts?: ShowOptions) => show("success", message, opts),
  error: (message: string, opts?: ShowOptions) => show("error", message, opts),
  info: (message: string, opts?: ShowOptions) => show("info", message, opts),
  dismiss: dismissToast,
};
