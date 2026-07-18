import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon.js";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gradient";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { height: number; padding: string; font: string; gap: number; icon: number }> = {
  sm: { height: 32, padding: "0 12px", font: "14px", gap: 6, icon: 16 },
  md: { height: 40, padding: "0 16px", font: "15px", gap: 8, icon: 18 },
  lg: { height: 48, padding: "0 20px", font: "16px", gap: 8, icon: 20 },
};

const VARIANTS: Record<Variant, CSSProperties> = {
  primary: { background: "var(--accent)", color: "var(--on-accent)" },
  secondary: { background: "var(--surface)", color: "var(--text-primary)", borderColor: "var(--border)" },
  ghost: { background: "transparent", color: "var(--accent)" },
  danger: { background: "var(--danger)", color: "#fff" },
  gradient: { background: "var(--balu-gradient)", color: "#fff" },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  fullWidth = false,
  children,
  style,
  ...rest
}: ButtonProps) {
  const s = SIZES[size];
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        fontFamily: "var(--font-sans)",
        fontSize: s.font,
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1,
        borderRadius: "var(--radius-control)",
        border: "1px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? "100%" : "auto",
        whiteSpace: "nowrap",
        userSelect: "none",
        transition:
          "background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)",
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={s.icon} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.icon} />}
    </button>
  );
}
