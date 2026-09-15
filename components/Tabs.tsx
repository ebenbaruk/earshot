"use client";

import clsx from "clsx";
import { useRef, type ReactNode } from "react";

export interface TabDef<K extends string = string> {
  key: K;
  label: string;
  /** Small count badge, e.g. the number of corrections. */
  badge?: ReactNode;
}

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly TabDef<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div
      role="tablist"
      aria-label="Right rail"
      className={clsx(
        "flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5",
        className,
      )}
    >
      {tabs.map((t, index) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            ref={(el) => { buttons.current[index] = el; }}
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            onKeyDown={(event) => {
              const key = event.key;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
              event.preventDefault();
              const next = key === "Home" ? 0 : key === "End" ? tabs.length - 1 : (index + (key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              onChange(tabs[next].key);
              buttons.current[next]?.focus();
            }}
            onClick={() => onChange(t.key)}
            className={clsx(
              "relative -mb-px flex shrink-0 items-center gap-1.5 border-b px-2 py-2.5 text-[11.5px] tracking-[0.08em] uppercase",
              "transition-colors duration-150 ease-out",
              active
                ? "border-accent text-ink"
                : "border-transparent text-faint hover:text-muted",
            )}
          >
            {t.label}
            {t.badge != null ? (
              <span
                className={clsx(
                  "tnum rounded px-1 py-px font-mono text-[10px] tracking-normal",
                  active ? "bg-accent-soft text-accent" : "bg-white/[0.06] text-faint",
                )}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
