import { useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { Icon } from "./Icon.js";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icon?: string;
  size?: "sm" | "md" | "lg";
  wrapperStyle?: CSSProperties;
}

export function Input({ icon, size = "md", disabled = false, style, wrapperStyle, ...rest }: InputProps) {
  const height = size === "lg" ? 48 : size === "sm" ? 32 : 40;
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height,
        padding: "0 12px",
        background: "var(--surface)",
        border: "1px solid",
        borderColor: focused ? "var(--accent)" : "var(--border)",
        borderRadius: "var(--radius-control)",
        boxShadow: focused ? "var(--ring-focus)" : "none",
        transition:
          "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
        opacity: disabled ? 0.5 : 1,
        ...wrapperStyle,
      }}
    >
      {icon && <Icon name={icon} size={18} color="var(--text-tertiary)" />}
      <input
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-body)",
          color: "var(--text-primary)",
          minWidth: 0,
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}
