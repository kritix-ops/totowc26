import { clsx } from "clsx";

export function Card({
  children,
  className,
  as: As = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const Component = As as keyof React.JSX.IntrinsicElements;
  return (
    <Component
      className={clsx(
        "bg-surface-container-low border border-outline-variant rounded-lg shadow-[0_8px_24px_rgba(28,20,15,0.06)]",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function PillButton({
  children,
  className,
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles = {
    primary:
      "bg-primary text-on-primary hover:bg-surface-tint shadow-md",
    secondary:
      "bg-secondary text-on-secondary hover:brightness-105 shadow-md",
    ghost:
      "bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container",
  }[variant];
  return (
    <button
      className={clsx(
        "press-down inline-flex items-center justify-center gap-2 font-[family-name:var(--font-label)] text-[14px] font-bold tracking-[0.05em] px-6 py-3 rounded-full transition-all duration-200",
        styles,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "primary" | "secondary" | "warning";
  className?: string;
}) {
  const tones = {
    default: "bg-surface-variant text-on-surface border-outline-variant",
    primary:
      "bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim",
    secondary:
      "bg-secondary-container text-on-secondary-container border-secondary-fixed",
    warning:
      "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim",
  }[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ScoreDigit({ value, dark }: { value: number | string; dark?: boolean }) {
  return (
    <div
      className={clsx(
        "min-w-[60px] px-3 py-2 rounded font-[family-name:var(--font-score)] text-[40px] leading-none tracking-[0.1em] font-bold text-center",
        dark
          ? "bg-[#110C09] border border-[#382e29] text-[#FBF6EB]"
          : "bg-surface-container border border-outline-variant text-on-surface",
      )}
    >
      <span className="bidi-ltr">{value}</span>
    </div>
  );
}

// `H – A` score where H sits adjacent to the home team and A adjacent to
// the away team — regardless of locale. The previous pattern wrapped
// "{home} - {away}" in `bidi-ltr` (LTR isolation), which forced the home
// number to the left of the score even when the home team was rendered
// on the right by the surrounding RTL flex. A Hebrew reader naturally
// associates the rightmost number with the rightmost team, so the score
// they saw next to a team was actually the OTHER team's. Rendering the
// two numbers as separate inline-flex children makes the score flow with
// the parent direction, so they line up under the team they belong to.
export function ScoreLine({
  home,
  away,
  className,
  separator = "-",
}: {
  home: number | string;
  away: number | string;
  className?: string;
  separator?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 tabular-nums whitespace-nowrap",
        className,
      )}
    >
      <span>{home}</span>
      <span aria-hidden className="opacity-70">
        {separator}
      </span>
      <span>{away}</span>
    </span>
  );
}

// "BRA vs GER" style matchup label. Same problem as ScoreLine: a single
// Latin string like "BRA vs GER" forces an LTR run that puts the home
// code on the left even in Hebrew, contradicting every other surface in
// the app where the home team sits on the right. Splitting the two
// codes into separate inline-flex children makes the label flow with
// the parent direction, so the home code lines up with the home side.
export function MatchupLabel({
  home,
  away,
  className,
  separatorHe = "נגד",
  separatorEn = "vs",
  locale,
}: {
  home: string;
  away: string;
  className?: string;
  separatorHe?: string;
  separatorEn?: string;
  locale: "he" | "en";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap",
        className,
      )}
    >
      <span>{home}</span>
      <span aria-hidden className="opacity-70">
        {locale === "he" ? separatorHe : separatorEn}
      </span>
      <span>{away}</span>
    </span>
  );
}

export function SectionHeading({
  children,
  underline = "primary",
  className,
  as = "h3",
}: {
  children: React.ReactNode;
  underline?: "primary" | "thin";
  className?: string;
  as?: "h2" | "h3" | "h4";
}) {
  const Tag = as;
  return (
    <Tag
      className={clsx(
        "font-[family-name:var(--font-display)] text-[24px] leading-8 font-bold inline-block",
        underline === "primary"
          ? "border-b-2 border-primary pb-1"
          : "border-b border-outline-variant pb-1",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function LabelCaps({
  children,
  className,
  as = "span",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "p" | "div";
}) {
  const Tag = as;
  return (
    <Tag
      className={clsx(
        "font-[family-name:var(--font-label)] text-[12px] leading-4 font-bold tracking-[0.05em] uppercase text-on-surface-variant",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
