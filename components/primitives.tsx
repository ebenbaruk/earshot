"use client";

/** Small local primitives. No shadcn — plain Tailwind, one file. */

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "./format";

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "quiet";
  size?: "sm" | "md";
  active?: boolean;
};

export function Button({
  variant = "ghost",
  size = "md",
  active = false,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,opacity] duration-150 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
        variant === "primary" &&
          "border border-accent bg-accent text-bg hover:enabled:bg-accent/90 hover:enabled:border-accent/90",
        variant === "ghost" &&
          "border border-line bg-raised text-ink hover:enabled:border-line-strong hover:enabled:bg-input",
        variant === "quiet" &&
          "border border-transparent text-muted hover:enabled:bg-raised hover:enabled:text-ink",
        active && variant === "ghost" && "border-line-strong bg-input text-ink",
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Chip                                                                        */
/* -------------------------------------------------------------------------- */

const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-line bg-white/[0.04] text-muted",
  ok: "border-ok/35 bg-ok-soft text-ok",
  warn: "border-accent/35 bg-accent-soft text-accent",
  danger: "border-danger/40 bg-danger-soft text-danger",
  accent: "border-accent/40 bg-accent-soft text-accent",
};

export function Chip({
  tone = "neutral",
  mono = false,
  className,
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap",
        mono && "font-mono",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel + section label                                                       */
/* -------------------------------------------------------------------------- */

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-line bg-panel",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Label({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={clsx("label", className)}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                      */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-[12px] text-muted transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink"
    >
      <span
        className={clsx(
          "relative h-3.5 w-6 rounded-full transition-colors duration-150 ease-out",
          checked ? "bg-accent/70" : "bg-white/15",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg transition-[left] duration-150 ease-out",
            checked ? "left-3" : "left-0.5",
          )}
        />
      </span>
      <span className={clsx(checked && "text-ink")}>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Thinking dots + spinner                                                     */
/* -------------------------------------------------------------------------- */

export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-end gap-[3px]", className)} aria-label="thinking">
      <span className="dot-1 h-[3px] w-[3px] rounded-full bg-current" />
      <span className="dot-2 h-[3px] w-[3px] rounded-full bg-current" />
      <span className="dot-3 h-[3px] w-[3px] rounded-full bg-current" />
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "spin inline-block h-3 w-3 rounded-full border border-current border-t-transparent",
        className,
      )}
      aria-hidden
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line px-4 py-6">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {children ? (
        <div className="max-w-[46ch] text-[12.5px] leading-relaxed text-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}
