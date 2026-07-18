import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon.js";

type Size = "sm" | "md" | "lg";
const DIM: Record<Size, number> = { sm: 28, md: 32, lg: 40 };
const ICON: Record<Size, number> = { sm: 16, md: 18, lg: 20 };

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  size?: Size;
  variant?: "ghost" | "solid";
  label: string;
  active?: boolean;
}

export function IconButton({
  icon,
  size = "md",
  variant = "ghost",
  label,
  disabled = false,
  active = false,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: DIM[size],
        height: DIM[size],
        borderRadius: "var(--radius-control)",
        border: "1px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: active ? "var(--accent)" : "var(--text-secondary)",
        background: active ? "var(--accent-wash)" : "transparent",
        ...(variant === "solid" ? { background: "var(--surface)", borderColor: "var(--border)" } : {}),
        transition:
          "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={ICON[size]} />
    </button>
  );
}
