// Catalog + helpers for the admin-controlled mobile navigation.
//
// The catalog is code-defined (single source of truth) and the admin
// config in `settings.mobile_nav_config` only stores ordered keys +
// bottom-bar size. Adding or removing a nav item requires editing this
// file. The admin UI then surfaces whatever keys exist in
// MOBILE_NAV_ITEM_KEYS.
//
// Role gating (Pay shown only to non-admins, Admin shown only to
// admins) is evaluated at render time, not stored in config — keeps
// the admin UI free of conditional rules.

export const MOBILE_NAV_ITEM_KEYS = [
  "home",
  "bets",
  "duels",
  "leaderboard",
  "tournament",
  "live",
  "transparency",
  "pay",
  "admin",
  "profile",
  "rules",
] as const;

export type MobileNavItemKey = (typeof MOBILE_NAV_ITEM_KEYS)[number];

export const MOBILE_NAV_KEY_SET: ReadonlySet<MobileNavItemKey> = new Set(
  MOBILE_NAV_ITEM_KEYS,
);

export type MobileNavConfig = {
  items: MobileNavItemKey[];
  bottomBarCount: number;
};

export const DEFAULT_MOBILE_NAV_CONFIG: MobileNavConfig = {
  items: [...MOBILE_NAV_ITEM_KEYS],
  bottomBarCount: 5,
};

export const MOBILE_NAV_BAR_MIN = 2;
export const MOBILE_NAV_BAR_MAX = 5;

// Per-key metadata. `path` is fed to `localePath`. `dictKey` indexes
// into `dict.nav`. `roleGate` is enforced at render time:
//   - "player" → only visible to non-admins (and non-scoped operators)
//   - "admin"  → only visible to admins OR scoped operators with any
//                permission (so a live-bets operator sees the doorway)
export type MobileNavItemMeta = {
  key: MobileNavItemKey;
  path: string;
  dictKey: keyof MobileNavDictKeys;
  roleGate?: "player" | "admin";
};

export type MobileNavDictKeys = {
  home: string;
  matchPicks: string;
  duels: string;
  leaders: string;
  tournament: string;
  liveScores: string;
  transparency: string;
  pay: string;
  admin: string;
  profile: string;
  rules: string;
};

export const MOBILE_NAV_CATALOG: Record<MobileNavItemKey, MobileNavItemMeta> = {
  home:         { key: "home",         path: "",             dictKey: "home" },
  bets:         { key: "bets",         path: "bets",         dictKey: "matchPicks" },
  duels:        { key: "duels",        path: "duels",        dictKey: "duels" },
  leaderboard:  { key: "leaderboard",  path: "leaderboard",  dictKey: "leaders" },
  tournament:   { key: "tournament",   path: "tournament",   dictKey: "tournament" },
  live:         { key: "live",         path: "live",         dictKey: "liveScores" },
  transparency: { key: "transparency", path: "transparency", dictKey: "transparency" },
  pay:          { key: "pay",          path: "pay",          dictKey: "pay",     roleGate: "player" },
  admin:        { key: "admin",        path: "admin",        dictKey: "admin",   roleGate: "admin" },
  profile:      { key: "profile",      path: "profile",      dictKey: "profile" },
  rules:        { key: "rules",        path: "rules",        dictKey: "rules" },
};

// Sanitises a stored config: drops unknown keys, deduplicates, clamps
// the count, ensures at least one item. Returns the default on total
// junk. Used both on read (defensive) and on write (after Zod).
export function normalizeMobileNavConfig(
  raw: unknown,
): MobileNavConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MOBILE_NAV_CONFIG };
  const r = raw as { items?: unknown; bottomBarCount?: unknown };

  const items: MobileNavItemKey[] = [];
  const seen = new Set<MobileNavItemKey>();
  if (Array.isArray(r.items)) {
    for (const v of r.items) {
      if (typeof v === "string" && MOBILE_NAV_KEY_SET.has(v as MobileNavItemKey)) {
        const k = v as MobileNavItemKey;
        if (!seen.has(k)) {
          items.push(k);
          seen.add(k);
        }
      } else {
        console.warn("[mobile nav unknown key]", { key: v });
      }
    }
  }

  let count =
    typeof r.bottomBarCount === "number" && Number.isFinite(r.bottomBarCount)
      ? Math.trunc(r.bottomBarCount)
      : DEFAULT_MOBILE_NAV_CONFIG.bottomBarCount;
  if (count < MOBILE_NAV_BAR_MIN) count = MOBILE_NAV_BAR_MIN;
  if (count > MOBILE_NAV_BAR_MAX) count = MOBILE_NAV_BAR_MAX;

  if (items.length === 0) {
    return { ...DEFAULT_MOBILE_NAV_CONFIG, bottomBarCount: count };
  }
  return { items, bottomBarCount: count };
}

// Splits a sanitised config into `bottom` (items shown directly in the
// bar) and `sheet` (items shown inside the More sheet) after applying
// role gates AND the admin-controlled page visibility list. The caller
// decides whether to render a "More" cell: render it iff `sheet.length > 0`.
//
// hiddenPages is the set of keys from settings.hidden_pages (see
// src/lib/page-visibility.ts). Hiding a page filters it out of nav
// here without mutating mobileNavConfig.items - the curated order is
// preserved, so re-enabling the page brings it back in place.
//
// Rule: if total visible items ≤ bottomBarCount, every item goes in the
// bar and the sheet is empty. Otherwise the bar holds (bottomBarCount−1)
// items + a "More" cell, and the remainder goes into the sheet.
export function splitMobileNavItems(
  config: MobileNavConfig,
  role: { isAdmin: boolean; canSeeAdminMenu: boolean },
  hiddenPages: ReadonlySet<string> = new Set(),
): { bottom: MobileNavItemKey[]; sheet: MobileNavItemKey[] } {
  // Scoped operators sit between the two states: they DO see Admin
  // (canSeeAdminMenu = true) but they ALSO still see Pay because the
  // system treats them as a regular player everywhere outside their
  // permitted admin paths. Only full admin (role 'admin') is exempt
  // from Pay — the same rule that's been in place since launch.
  const visible = config.items.filter((k) => {
    if (hiddenPages.has(k)) return false;
    const meta = MOBILE_NAV_CATALOG[k];
    if (!meta.roleGate) return true;
    if (meta.roleGate === "admin") return role.canSeeAdminMenu;
    if (meta.roleGate === "player") return !role.isAdmin;
    return true;
  });

  if (visible.length <= config.bottomBarCount) {
    return { bottom: visible, sheet: [] };
  }
  const barSlots = Math.max(0, config.bottomBarCount - 1);
  return {
    bottom: visible.slice(0, barSlots),
    sheet: visible.slice(barSlots),
  };
}
