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
 * the items (used for the project color swatches). A trigger that toggles its
 * own menu marks itself with `data-menu-trigger`: the outside-mousedown close
 * ignores mousedown on such an element, so the trigger's own click can decide
 * open/close instead of the close instantly reopening it. On close, focus
 * returns to the element focused when the menu opened, but only if focus has
 * since fallen to <body>; focus taken deliberately elsewhere is left alone.
 */
export function Menu({ anchor, items, onClose, children }: { anchor: MenuAnchor; items: MenuItem[]; onClose: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuAnchor>(anchor);
  // Capture the opener at first render, not inside the effect: StrictMode
  // double-invokes effects, and the second run would otherwise capture the
  // first run's focused menuitem as the opener, making the restore inert in dev.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  // Callers often pass a fresh closure each render; keep it in a ref so the
  // listeners below are bound once instead of being re-bound (and re-focusing)
  // on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    // Focus the first item once on open (not on every parent re-render).
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      // Restore focus to the opener only if it fell to <body> (Escape or item
      // selection dropping focus). If focus moved elsewhere on its own - e.g.
      // a rename input mounting in the same commit this menu unmounts - leave
      // it where it is.
      if (opener?.isConnected && (document.activeElement ?? document.body) === document.body) opener.focus();
    };
  }, [opener]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target)) return;
      // The "..." trigger toggles its own menu; ignoring its mousedown keeps
      // the outside-close from immediately reopening it.
      if (target?.closest?.("[data-menu-trigger]")) return;
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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
