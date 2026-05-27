import {
  BookOpen,
  Eye,
  Globe2,
  Home,
  ListChecks,
  Radio,
  Shield,
  Swords,
  Trophy,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import type { MobileNavItemKey } from "./mobile-nav";

// React element factory for each nav key. Lives in its own file so the
// pure data catalog (`mobile-nav.ts`) stays free of JSX and importable
// from non-React contexts (server actions, tests). Strokes match the
// previous hardcoded values in AppShell + MobileMoreSheet.
export function MobileNavIcon({
  itemKey,
  className,
}: {
  itemKey: MobileNavItemKey;
  className?: string;
}) {
  const cls = className ?? "h-5 w-5";
  switch (itemKey) {
    case "home":
      return <Home className={cls} strokeWidth={1.75} />;
    case "bets":
      return <ListChecks className={cls} strokeWidth={1.75} />;
    case "duels":
      return <Swords className={cls} strokeWidth={1.75} />;
    case "leaderboard":
      return <Trophy className={cls} strokeWidth={1.75} />;
    case "tournament":
      return <Globe2 className={cls} strokeWidth={1.75} />;
    case "live":
      return <Radio className={cls} strokeWidth={1.75} />;
    case "transparency":
      return <Eye className={cls} strokeWidth={1.75} />;
    case "pay":
      return <Wallet className={cls} strokeWidth={1.75} />;
    case "admin":
      return <Shield className={cls} strokeWidth={1.75} />;
    case "profile":
      return <UserIcon className={cls} strokeWidth={1.75} />;
    case "rules":
      return <BookOpen className={cls} strokeWidth={1.75} />;
  }
}
