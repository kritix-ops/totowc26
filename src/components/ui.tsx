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
