"use client";

import {
  useState,
  useMemo,
  useTransition,
  useDeferredValue,
  useEffect,
} from "react";
import { clsx } from "clsx";
import {
  Search,
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  Shield,
  ShieldOff,
  UserMinus,
  Send,
  Pencil,
  RotateCcw,
  Wallet,
  Phone,
  Mail,
  Check,
  Trophy,
  ChevronDown,
  UserPlus,
  Copy,
  Link2,
  MessageCircle,
} from "lucide-react";
import type { Locale } from "../../dictionaries";
import { formatDateTime } from "@/lib/format";
import { PillButton, LabelCaps, Chip } from "@/components/ui";
import {
  setUserRole,
  updateUserProfile,
  decidePayment,
  manualMarkPaid,
  bulkApprovePending,
  removeUser,
  resendMagicLink,
  resetUserPicks,
  invitePlayer,
  regenerateInviteLink,
} from "./actions";
import type { AdminUserRow } from "./queries";

type FilterKey = "all" | "approved" | "pending" | "unpaid" | "admin";
type SortKey = "newest" | "oldest" | "points_desc" | "points_asc" | "name";

const FILTERS_HE: Record<FilterKey, string> = {
  all: "הכל",
  approved: "שילמו",
  pending: "ממתינים",
  unpaid: "לא שילמו",
  admin: "אדמינים",
};
const FILTERS_EN: Record<FilterKey, string> = {
  all: "All",
  approved: "Approved",
  pending: "Pending",
  unpaid: "Unpaid",
  admin: "Admins",
};

const SORTS_HE: Record<SortKey, string> = {
  newest: "חדש ביותר",
  oldest: "ישן ביותר",
  points_desc: "נקודות (גבוה לנמוך)",
  points_asc: "נקודות (נמוך לגבוה)",
  name: "שם (א-ת)",
};
const SORTS_EN: Record<SortKey, string> = {
  newest: "Newest",
  oldest: "Oldest",
  points_desc: "Points (high to low)",
  points_asc: "Points (low to high)",
  name: "Name (A-Z)",
};

export function UsersExplorer({
  users,
  locale,
}: {
  users: AdminUserRow[];
  locale: Locale;
  entryFee: number;
}) {
  const isHebrew = locale === "he";
  const F = isHebrew ? FILTERS_HE : FILTERS_EN;
  const S = isHebrew ? SORTS_HE : SORTS_EN;

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let list = users.filter((u) => {
      if (q) {
        const hay = `${u.displayName} ${u.phone} ${u.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === "approved") return u.paymentStatus === "approved";
      if (filter === "pending") return u.paymentStatus === "pending";
      if (filter === "unpaid") return !u.paymentStatus;
      if (filter === "admin") return u.role === "admin";
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "points_desc":
          return b.totalPoints - a.totalPoints;
        case "points_asc":
          return a.totalPoints - b.totalPoints;
        case "name":
          return a.displayName.localeCompare(b.displayName, isHebrew ? "he" : "en");
      }
    });
    return list;
  }, [users, deferredQuery, filter, sort, isHebrew]);

  const openUser = users.find((u) => u.id === openUserId) ?? null;
  const allSelected =
    filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      filtered.forEach((u) => next.delete(u.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((u) => next.add(u.id));
      setSelected(next);
    }
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const pendingCount = users.filter((u) => u.paymentStatus === "pending").length;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        isHebrew={isHebrew}
        F={F}
        S={S}
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        sort={sort}
        setSort={setSort}
        pendingCount={pendingCount}
        selectedCount={selected.size}
        onInvite={() => setInviteOpen(true)}
      />

      <div className="hidden md:block">
        <UsersTable
          users={filtered}
          locale={locale}
          allSelected={allSelected}
          selected={selected}
          toggleAll={toggleAll}
          toggleOne={toggleOne}
          openUser={setOpenUserId}
        />
      </div>
      <div className="md:hidden flex flex-col gap-3">
        {filtered.length === 0 ? (
          <EmptyState isHebrew={isHebrew} />
        ) : (
          filtered.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              locale={locale}
              selected={selected.has(u.id)}
              onSelect={() => toggleOne(u.id)}
              onOpen={() => setOpenUserId(u.id)}
            />
          ))
        )}
      </div>

      {openUser && (
        <UserDrawer
          user={openUser}
          locale={locale}
          onClose={() => setOpenUserId(null)}
        />
      )}

      {inviteOpen && (
        <InviteDialog locale={locale} onClose={() => setInviteOpen(false)} />
      )}
    </div>
  );
}

function Toolbar({
  isHebrew,
  F,
  S,
  query,
  setQuery,
  filter,
  setFilter,
  sort,
  setSort,
  pendingCount,
  selectedCount,
  onInvite,
}: {
  isHebrew: boolean;
  F: Record<FilterKey, string>;
  S: Record<SortKey, string>;
  query: string;
  setQuery: (s: string) => void;
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  pendingCount: number;
  selectedCount: number;
  onInvite: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const onBulkApprove = () => {
    if (!pendingCount) return;
    startTransition(async () => {
      await bulkApprovePending();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <Search
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 h-4 w-4 text-outline pointer-events-none",
              isHebrew ? "right-3" : "left-3",
            )}
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHebrew ? "חפש לפי שם, טלפון או מייל" : "Search name, phone or email"}
            className={clsx(
              "w-full h-11 rounded-full bg-surface-container-lowest border border-outline-variant focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant",
              isHebrew ? "pr-9 pl-3" : "pl-9 pr-3",
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="clear"
              className={clsx(
                "absolute top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-surface-container",
                isHebrew ? "left-2" : "right-2",
              )}
            >
              <X className="h-4 w-4 text-on-surface-variant" />
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-11 px-3 rounded-full bg-surface-container-lowest border border-outline-variant text-sm font-bold text-on-surface focus:outline-none focus:border-primary cursor-pointer"
          >
            {(Object.keys(S) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {S[k]}
              </option>
            ))}
          </select>

          <PillButton
            type="button"
            variant="primary"
            onClick={onInvite}
            className="text-sm whitespace-nowrap px-4 py-2.5"
          >
            <UserPlus className="h-4 w-4" strokeWidth={2} />
            {isHebrew ? "הוסף משתתף" : "Add player"}
          </PillButton>

          {pendingCount > 0 && (
            <PillButton
              type="button"
              variant="secondary"
              onClick={onBulkApprove}
              disabled={pending}
              className="text-sm whitespace-nowrap px-4 py-2.5"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? `אשר ${pendingCount} ממתינים` : `Approve ${pendingCount} pending`}
            </PillButton>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {(Object.keys(F) as FilterKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={clsx(
              "snap-start min-h-[36px] px-4 py-1.5 rounded-full text-sm font-bold border whitespace-nowrap transition-colors shrink-0",
              filter === k
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container",
            )}
          >
            {F[k]}
          </button>
        ))}
        {selectedCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-xs font-bold">
            <Check className="h-3 w-3" />
            {isHebrew ? `נבחרו: ${selectedCount}` : `Selected: ${selectedCount}`}
          </span>
        )}
      </div>
    </div>
  );
}

function UsersTable({
  users,
  locale,
  allSelected,
  selected,
  toggleAll,
  toggleOne,
  openUser,
}: {
  users: AdminUserRow[];
  locale: Locale;
  allSelected: boolean;
  selected: Set<string>;
  toggleAll: () => void;
  toggleOne: (id: string) => void;
  openUser: (id: string) => void;
}) {
  const isHebrew = locale === "he";
  if (users.length === 0) return <EmptyState isHebrew={isHebrew} />;
  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-surface-container">
          <tr className="text-start">
            <th className="px-3 py-3 w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="select all"
                className="w-4 h-4 accent-primary cursor-pointer"
              />
            </th>
            <Th>{isHebrew ? "משתתף" : "Player"}</Th>
            <Th>{isHebrew ? "תפקיד" : "Role"}</Th>
            <Th>{isHebrew ? "תשלום" : "Payment"}</Th>
            <Th>{isHebrew ? "נקודות" : "Points"}</Th>
            <Th>{isHebrew ? "הצטרף" : "Joined"}</Th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className="border-t border-outline-variant hover:bg-surface-container-low transition-colors cursor-pointer"
              onClick={() => openUser(u.id)}
            >
              <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => toggleOne(u.id)}
                  aria-label={`select ${u.displayName}`}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={u.displayName} />
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-base truncate">{u.displayName}</span>
                    <span className="text-xs text-on-surface-variant truncate bidi-ltr">
                      {u.email ?? u.phone}
                    </span>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3">
                <RoleBadge role={u.role} isHebrew={isHebrew} />
              </td>
              <td className="px-3 py-3">
                <PaymentBadge status={u.paymentStatus} method={u.paymentMethod} isHebrew={isHebrew} />
              </td>
              <td className="px-3 py-3">
                <span className="font-[family-name:var(--font-display)] text-lg font-bold text-surface-tint">
                  <span className="bidi-ltr">{u.totalPoints}</span>
                </span>
              </td>
              <td className="px-3 py-3 text-sm text-on-surface-variant whitespace-nowrap">
                {formatDate(u.createdAt, locale)}
              </td>
              <td className="px-3 py-3 text-end">
                <ChevronDown className="h-4 w-4 text-outline inline-block -rotate-90" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-3 text-start text-xs font-bold tracking-[0.05em] uppercase text-on-surface-variant">
      {children}
    </th>
  );
}

function UserCard({
  user,
  locale,
  selected,
  onSelect,
  onOpen,
}: {
  user: AdminUserRow;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const isHebrew = locale === "he";
  return (
    <div
      className={clsx(
        "rounded-lg border bg-surface-container-lowest p-4 flex flex-col gap-3 transition-colors",
        selected ? "border-primary bg-primary-fixed" : "border-outline-variant",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`select ${user.displayName}`}
          className="w-5 h-5 mt-1 accent-primary cursor-pointer shrink-0"
        />
        <Avatar name={user.displayName} />
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 text-start min-w-0"
        >
          <div className="font-bold text-base truncate">{user.displayName}</div>
          <div className="text-xs text-on-surface-variant truncate bidi-ltr">
            {user.email ?? user.phone}
          </div>
        </button>
        <span className="font-[family-name:var(--font-display)] text-xl font-bold text-surface-tint shrink-0">
          <span className="bidi-ltr">{user.totalPoints}</span>
          <span className="text-xs text-on-surface-variant"> {isHebrew ? "נק'" : "pts"}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RoleBadge role={user.role} isHebrew={isHebrew} />
        <PaymentBadge status={user.paymentStatus} method={user.paymentMethod} isHebrew={isHebrew} />
        <span className="text-xs text-on-surface-variant ms-auto">
          {formatDate(user.createdAt, locale)}
        </span>
      </div>
    </div>
  );
}

function EmptyState({ isHebrew }: { isHebrew: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-10 text-center text-on-surface-variant">
      {isHebrew ? "לא נמצאו משתתפים" : "No users match the filters"}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center font-bold text-on-surface shrink-0"
      aria-hidden
    >
      {name.charAt(0) || "?"}
    </div>
  );
}

function RoleBadge({ role, isHebrew }: { role: "player" | "admin"; isHebrew: boolean }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim text-xs font-bold">
        <Shield className="h-3 w-3" strokeWidth={2} />
        {isHebrew ? "אדמין" : "Admin"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant border border-outline-variant text-xs font-bold">
      {isHebrew ? "משתתף" : "Player"}
    </span>
  );
}

function PaymentBadge({
  status,
  method,
  isHebrew,
}: {
  status: AdminUserRow["paymentStatus"];
  method: AdminUserRow["paymentMethod"];
  isHebrew: boolean;
}) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container border border-secondary-fixed text-xs font-bold">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        {isHebrew ? "שולם" : "Paid"}
        {method && <span className="opacity-70">· {method}</span>}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim text-xs font-bold">
        <Clock className="h-3 w-3" strokeWidth={2} />
        {isHebrew ? "ממתין" : "Pending"}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container border text-xs font-bold">
        <AlertCircle className="h-3 w-3" strokeWidth={2} />
        {isHebrew ? "נדחה" : "Rejected"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-container-lowest text-on-surface-variant border border-outline-variant text-xs font-bold">
      {isHebrew ? "לא שילם" : "Unpaid"}
    </span>
  );
}

function formatDate(value: string | Date, locale: Locale) {
  try {
    return formatDateTime(value, locale, {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function UserDrawer({
  user,
  locale,
  onClose,
}: {
  user: AdminUserRow;
  locale: Locale;
  onClose: () => void;
}) {
  const isHebrew = locale === "he";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "reset" | "demote" | null>(null);
  const [regeneratedLink, setRegeneratedLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setName(user.displayName);
    setPhone(user.phone);
    setEditing(false);
    setConfirm(null);
    setRegeneratedLink(null);
  }, [user.id, user.displayName, user.phone]);

  const wrap = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
    });

  const action = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={clsx(
        "press-down min-h-[48px] w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-base font-bold text-start transition-colors",
        danger
          ? "border-error text-error bg-error-container/30 hover:bg-error-container"
          : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container",
        pending && "opacity-60 cursor-wait",
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px]" />
      <div
        className={clsx(
          "relative ms-auto bg-surface w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col",
          "md:rounded-s-2xl",
        )}
      >
        <header className="sticky top-0 bg-surface border-b border-outline-variant px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">
            {isHebrew ? "פרטי משתתף" : "User details"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-5 flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center text-2xl font-bold"
              aria-hidden
            >
              {user.displayName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-[family-name:var(--font-display)] text-2xl font-bold truncate">
                {user.displayName}
              </div>
              <div className="flex flex-col gap-0.5 text-sm text-on-surface-variant mt-1">
                {user.email && (
                  <span className="inline-flex items-center gap-1.5 bidi-ltr truncate">
                    <Mail className="h-3.5 w-3.5" />
                    {user.email}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 bidi-ltr">
                  <Phone className="h-3.5 w-3.5" />
                  {user.phone || "—"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat
              label={isHebrew ? "נקודות" : "Points"}
              value={user.totalPoints}
              accent="text-primary"
            />
            <Stat
              label={isHebrew ? "הימורים" : "Bets"}
              value={user.betCount}
            />
            <Stat
              label={isHebrew ? "הצטרף" : "Joined"}
              value={formatDate(user.createdAt, locale)}
              small
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <RoleBadge role={user.role} isHebrew={isHebrew} />
            <PaymentBadge
              status={user.paymentStatus}
              method={user.paymentMethod}
              isHebrew={isHebrew}
            />
          </div>

          {editing ? (
            <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 flex flex-col gap-3">
              <LabelCaps>{isHebrew ? "עריכה" : "Editing"}</LabelCaps>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 px-3 rounded bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base"
                placeholder={isHebrew ? "שם מלא" : "Full name"}
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                className="h-12 px-3 rounded bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base"
                placeholder={isHebrew ? "טלפון" : "Phone"}
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm font-bold text-on-surface-variant"
                >
                  {isHebrew ? "ביטול" : "Cancel"}
                </button>
                <PillButton
                  type="button"
                  variant="primary"
                  onClick={() =>
                    wrap(async () => {
                      const r = await updateUserProfile(user.id, name, phone);
                      if (r.ok) setEditing(false);
                      return r;
                    })
                  }
                  className="text-sm px-4 py-2"
                >
                  {isHebrew ? "שמור" : "Save"}
                </PillButton>
              </div>
            </div>
          ) : null}

          <section className="flex flex-col gap-2">
            <LabelCaps>{isHebrew ? "פעולות" : "Actions"}</LabelCaps>

            {!editing && action(
              isHebrew ? "ערוך פרטים" : "Edit details",
              <Pencil className="h-4 w-4" />,
              () => setEditing(true),
            )}

            {user.paymentStatus === "pending" && user.paymentId && (
              <>
                {action(
                  isHebrew ? "אשר תשלום" : "Approve payment",
                  <CheckCircle2 className="h-4 w-4 text-secondary" />,
                  () => wrap(() => decidePayment(user.paymentId!, "approved")),
                )}
                {action(
                  isHebrew ? "דחה תשלום" : "Reject payment",
                  <AlertCircle className="h-4 w-4 text-error" />,
                  () => wrap(() => decidePayment(user.paymentId!, "rejected")),
                )}
              </>
            )}

            {user.paymentStatus !== "approved" && action(
              isHebrew ? "סמן ידנית כשולם (ביט)" : "Mark paid manually (Bit)",
              <Wallet className="h-4 w-4 text-secondary" />,
              () => wrap(() => manualMarkPaid(user.id, "bit")),
            )}

            {action(
              user.role === "admin"
                ? isHebrew ? "הסר הרשאת אדמין" : "Revoke admin"
                : isHebrew ? "הפוך לאדמין" : "Make admin",
              user.role === "admin" ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />,
              () =>
                user.role === "admin"
                  ? setConfirm("demote")
                  : wrap(() => setUserRole(user.id, "admin")),
            )}

            {user.email && action(
              isHebrew ? "צור קישור הזמנה חדש" : "Regenerate invite link",
              <Send className="h-4 w-4" />,
              () =>
                startTransition(async () => {
                  setError(null);
                  setLinkCopied(false);
                  const res = await regenerateInviteLink(
                    user.email!,
                    window.location.origin,
                  );
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setRegeneratedLink(res.inviteUrl);
                }),
            )}

            {action(
              isHebrew ? "אפס בחירות" : "Reset picks",
              <RotateCcw className="h-4 w-4 text-tertiary" />,
              () => setConfirm("reset"),
            )}

            {action(
              isHebrew ? "הסר מהקבוצה" : "Remove from pool",
              <UserMinus className="h-4 w-4" />,
              () => setConfirm("remove"),
              true,
            )}
          </section>

          {confirm && (
            <ConfirmPanel
              kind={confirm}
              isHebrew={isHebrew}
              userName={user.displayName}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                if (confirm === "remove") {
                  wrap(async () => {
                    const r = await removeUser(user.id);
                    if (r.ok) onClose();
                    return r;
                  });
                } else if (confirm === "reset") {
                  wrap(async () => {
                    const r = await resetUserPicks(user.id);
                    setConfirm(null);
                    return r;
                  });
                } else if (confirm === "demote") {
                  wrap(async () => {
                    const r = await setUserRole(user.id, "player");
                    setConfirm(null);
                    return r;
                  });
                }
              }}
              pending={pending}
            />
          )}

          {regeneratedLink && (
            <div className="bg-secondary-container/40 border border-secondary-fixed rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-secondary text-sm font-bold">
                <CheckCircle2 className="h-4 w-4" />
                {isHebrew ? "קישור חדש מוכן" : "New link ready"}
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant rounded p-2 flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-outline shrink-0" />
                <input
                  readOnly
                  value={regeneratedLink}
                  onFocus={(e) => e.target.select()}
                  dir="ltr"
                  className="flex-1 min-w-0 bg-transparent text-xs text-on-surface focus:outline-none truncate"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(regeneratedLink);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1500);
                    } catch {}
                  }}
                  aria-label="copy"
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-surface-container text-primary"
                >
                  {linkCopied ? (
                    <Check className="h-4 w-4 text-secondary" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  isHebrew
                    ? `היי ${user.displayName}, קישור חדש להתחברות לטוטו: ${regeneratedLink}`
                    : `Hey ${user.displayName}, fresh sign-in link: ${regeneratedLink}`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="press-down min-h-[44px] w-full flex items-center justify-center gap-2 rounded-full bg-[#25D366] text-white font-bold text-sm px-4 py-2.5"
              >
                <MessageCircle className="h-4 w-4" />
                {isHebrew ? "שלח בוואטסאפ" : "Send via WhatsApp"}
              </a>
            </div>
          )}

          {error && (
            <Chip tone="warning" className="self-start">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{translateError(error, isHebrew)}</span>
            </Chip>
          )}

          <div className="flex items-center gap-2 text-xs text-on-surface-variant pt-4 border-t border-outline-variant">
            <Trophy className="h-3 w-3" />
            <span>
              {isHebrew ? "מזהה משתמש" : "User ID"}:{" "}
              <span className="bidi-ltr font-mono">{user.id.slice(0, 8)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string | number;
  accent?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-surface-container-low border border-outline-variant rounded p-3 flex flex-col gap-1 text-center">
      <LabelCaps>{label}</LabelCaps>
      <div
        className={clsx(
          "font-[family-name:var(--font-display)] font-bold leading-none truncate",
          accent ?? "text-on-surface",
          small ? "text-sm" : "text-xl",
        )}
      >
        <span className="bidi-ltr">{value}</span>
      </div>
    </div>
  );
}

function ConfirmPanel({
  kind,
  isHebrew,
  userName,
  onCancel,
  onConfirm,
  pending,
}: {
  kind: "remove" | "reset" | "demote";
  isHebrew: boolean;
  userName: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const titles: Record<typeof kind, [string, string]> = {
    remove: [
      isHebrew ? "להסיר את המשתתף?" : "Remove user?",
      isHebrew
        ? `כל ההימורים, התחזיות והתשלומים של ${userName} יימחקו. הפעולה לא הפיכה.`
        : `All bets, predictions and payments for ${userName} will be deleted. This cannot be undone.`,
    ],
    reset: [
      isHebrew ? "לאפס בחירות?" : "Reset picks?",
      isHebrew
        ? `הימורי המשחקים, דירוג הבתים והבראקט של ${userName} יימחקו. הפרופיל והתשלום יישמרו.`
        : `${userName}'s match bets, group ranking and bracket will be deleted. Profile and payment remain.`,
    ],
    demote: [
      isHebrew ? "להוריד הרשאת אדמין?" : "Revoke admin?",
      isHebrew
        ? `${userName} יחזור לתפקיד משתתף רגיל.`
        : `${userName} will become a regular player.`,
    ],
  };
  const [title, body] = titles[kind];

  return (
    <div className="bg-error-container/30 border border-error rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-bold text-on-error-container">{title}</div>
          <p className="text-sm text-on-surface-variant mt-1">{body}</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 py-2 text-sm font-bold rounded-full text-on-surface-variant hover:bg-surface-container"
        >
          {isHebrew ? "ביטול" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={clsx(
            "press-down min-h-[44px] px-5 py-2 text-sm font-bold rounded-full bg-error text-on-error",
            pending && "opacity-60 cursor-wait",
          )}
        >
          {kind === "remove"
            ? isHebrew ? "כן, הסר" : "Yes, remove"
            : kind === "reset"
              ? isHebrew ? "כן, אפס" : "Yes, reset"
              : isHebrew ? "כן, הורד" : "Yes, demote"}
        </button>
      </div>
    </div>
  );
}

function translateError(code: string, isHebrew: boolean) {
  const map: Record<string, [string, string]> = {
    unauthorized: ["יש להתחבר", "Sign in required"],
    forbidden: ["נדרשת הרשאת אדמין", "Admin access required"],
    last_admin: ["לא ניתן להסיר את האדמין האחרון", "Cannot remove the last admin"],
    cannot_demote_self: ["לא ניתן להוריד את עצמך", "Cannot demote yourself"],
    cannot_remove_self: ["לא ניתן להסיר את עצמך", "Cannot remove yourself"],
    invalid: ["שם או טלפון לא תקינים", "Invalid name or phone"],
    invalid_email: ["מייל לא תקין", "Invalid email"],
    name_too_short: ["השם קצר מדי", "Name too short"],
    phone_too_short: ["מספר טלפון קצר מדי", "Phone too short"],
    email_taken: ["מייל כבר רשום במערכת", "Email already registered"],
    create_failed: ["יצירת המשתמש נכשלה", "User creation failed"],
    no_link: ["לא הצלחנו לייצר קישור", "Failed to generate link"],
    db: ["שגיאת מסד נתונים", "Database error"],
  };
  const t = map[code];
  return t ? (isHebrew ? t[0] : t[1]) : code;
}

function InviteDialog({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const isHebrew = locale === "he";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await invitePlayer(name, phone, email, window.location.origin);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInviteUrl(res.inviteUrl);
    });
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const waText = isHebrew
    ? `היי ${name}, צירפתי אותך לטוטו המונדיאל. הקליק כדי לקבוע סיסמה ולהיכנס:\n${inviteUrl ?? ""}`
    : `Hey ${name}, I added you to our World Cup pool. Click to set a password and sign in:\n${inviteUrl ?? ""}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px]" />
      <div className="relative bg-surface w-full max-w-md max-h-[100dvh] md:max-h-[90dvh] overflow-y-auto md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <header className="sticky top-0 bg-surface border-b border-outline-variant px-5 py-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold inline-flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            {isHebrew ? "הוסף משתתף" : "Add player"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {!inviteUrl ? (
          <form onSubmit={submit} className="p-5 flex flex-col gap-5">
            <p className="text-sm text-on-surface-variant">
              {isHebrew
                ? "מלא את פרטי החבר ולחץ צור הזמנה. תקבל קישור אישי שאפשר לשלוח בוואטסאפ."
                : "Fill in your friend's details and click Generate. You get a personal link to share via WhatsApp."}
            </p>
            <label className="flex flex-col gap-1">
              <LabelCaps>{isHebrew ? "שם מלא" : "Full name"}</LabelCaps>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isHebrew ? "דנה לוי" : "Dana Levi"}
                className="h-12 px-3 rounded bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base"
              />
            </label>
            <label className="flex flex-col gap-1">
              <LabelCaps>{isHebrew ? "טלפון" : "Phone"}</LabelCaps>
              <input
                type="tel"
                required
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-1234567"
                className="h-12 px-3 rounded bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-left"
              />
            </label>
            <label className="flex flex-col gap-1">
              <LabelCaps>{isHebrew ? "מייל" : "Email"}</LabelCaps>
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dana@example.com"
                className="h-12 px-3 rounded bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-left"
              />
            </label>

            {error && (
              <Chip tone="warning" className="self-start">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{translateError(error, isHebrew)}</span>
              </Chip>
            )}

            <PillButton
              type="submit"
              disabled={pending}
              className={clsx("w-full py-4 text-base", pending && "opacity-70 cursor-wait")}
            >
              {pending ? (isHebrew ? "יוצר..." : "Generating...") : (isHebrew ? "צור קישור הזמנה" : "Generate invite link")}
            </PillButton>
          </form>
        ) : (
          <div className="p-5 flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-secondary" strokeWidth={2} />
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold">
                {isHebrew ? "המשתתף נוסף" : "Player added"}
              </h3>
              <p className="text-sm text-on-surface-variant">
                {isHebrew
                  ? `שלח את הקישור הבא ל${name} כדי שיגדיר סיסמה`
                  : `Share this link with ${name} so they can set a password`}
              </p>
            </div>

            <div className="bg-surface-container-low border border-outline-variant rounded p-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-outline shrink-0" />
              <input
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
                dir="ltr"
                className="flex-1 min-w-0 bg-transparent text-xs text-on-surface focus:outline-none truncate"
              />
              <button
                type="button"
                onClick={copyLink}
                aria-label="copy"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-container text-primary"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-secondary" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="press-down min-h-[48px] w-full flex items-center justify-center gap-2 rounded-full bg-[#25D366] text-white font-bold text-base px-6 py-3"
              >
                <MessageCircle className="h-5 w-5" />
                {isHebrew ? "שלח בוואטסאפ" : "Send via WhatsApp"}
              </a>
              <button
                type="button"
                onClick={() => {
                  setName("");
                  setPhone("");
                  setEmail("");
                  setInviteUrl(null);
                }}
                className="min-h-[44px] text-sm text-on-surface-variant hover:text-primary"
              >
                {isHebrew ? "הוסף משתתף נוסף" : "Add another player"}
              </button>
            </div>

            <p className="text-xs text-on-surface-variant text-center leading-5">
              {isHebrew
                ? "הקישור יפוג תוך 24 שעות. תוכל לחדש אותו דרך הפרופיל של המשתתף."
                : "The link expires in 24 hours. You can regenerate it from the user's profile."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
