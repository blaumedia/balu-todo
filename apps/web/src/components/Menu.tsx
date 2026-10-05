import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon.js";

/** Viewport coordinates the menu's top-left corner is placed at. */
export interface MenuAnchor {
  x: number;
  y: number;
}

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
  onSelect: () => void;
}

const MARGIN = 8;
const WIDTH = 220;

/**
 * Fixed-position popover menu (the WorkspaceSwitcher idiom, generalised).
 * Closes on Escape and on any mousedown outside; ArrowUp/ArrowDown move focus
 * between items; the first item is focused on open. `children` render above
 * the items (used for the project color swatches).
 */
export function Menu({ anchor, items, onClose, children }: { anchor: MenuAnchor; items: MenuItem[]; onClose: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuAnchor>(anchor);

  // Keep the menu inside the viewport (a row near the bottom of the sidebar
  // would otherwise open off-screen).
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - rect.width - MARGIN));
    const y = Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - rect.height - MARGIN));
    setPos({ x, y });
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    if (nodes.length === 0) return;
    const i = nodes.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % nodes.length : (i - 1 + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }

  const item: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    border: "none",
    borderRadius: "var(--radius-control)",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    width: "100%",
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="balu-overlay-in"
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        top: pos.y,
        left: pos.x,
        width: WIDTH,
        zIndex: 50,
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sheet)",
        boxShadow: "var(--elevation-3)",
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {children}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          onClick={it.onSelect}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--slate-100)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          style={{ ...item, color: it.danger ? "var(--danger)" : "var(--text-primary)" }}
        >
          <Icon name={it.icon} size={16} color={it.danger ? "var(--danger)" : "var(--text-secondary)"} />
          <span style={{ flex: 1 }}>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
