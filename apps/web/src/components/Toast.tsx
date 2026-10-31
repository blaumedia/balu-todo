import { useEffect, useId, useRef } from "react";
import { useApp } from "../store/app.js";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

/** Ambient bottom-center toast (DESIGN §3 — calm, non-modal). */
export function Toast() {
  const toast = useApp((s) => s.toast);
  const action = useApp((s) => s.toastAction);
  const tone = useApp((s) => s.toastTone);
  const seq = useApp((s) => s.toastSeq);
  const messageId = useId();
  const dismissToast = useApp((s) => s.dismissToast);
  const holdToast = useApp((s) => s.holdToast);
  // Where focus was before it moved onto the toast, to give it back on dismiss.
  const returnFocus = useRef<Element | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  // A replaced toast can unmount the focused action button without a blur
  // event: give focus back to where it came from, if it fell to the page.
  useEffect(() => {
    if (action || !returnFocus.current) return;
    const back = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    if ((!active || active === document.body) && back instanceof HTMLElement && back.isConnected) back.focus();
  }, [toast, action]);
  // The live regions stay mounted (empty) so screen readers announce the text
  // that appears inside them; a region created together with its text is often
  // missed. They carry only the message (not the button); errors go to the
  // assertive one. The visible copy is hidden from assistive tech.
  const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
  return (
    <>
      <div role="status" style={srOnly}>{toast && tone !== "error" ? <span key={seq}>{toast}</span> : null}</div>
      <div role="alert" style={srOnly}>{toast && tone === "error" ? <span key={seq}>{toast}</span> : null}</div>
      {toast && (
        <div
          ref={box}
          onMouseEnter={() => holdToast("hover", true)}
          onMouseLeave={() => holdToast("hover", false)}
          onFocus={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) returnFocus.current = e.relatedTarget as Element | null;
            holdToast("focus", true);
          }}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            holdToast("focus", false);
            // Focus went elsewhere on purpose: do not pull it back later.
            returnFocus.current = null;
          }}
          onKeyDown={(e) => {
            // Keep these keys from reaching Shell's window listener (React's
            // handler runs first): Enter/Space must activate the toast button,
            // not open or complete a task; Escape must only dismiss the toast.
            if (e.key === "Escape") {
              dismissToast();
              e.stopPropagation();
            } else if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
          className="balu-overlay-in"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            marginInline: "auto",
            width: "fit-content",
            bottom: 32,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 10,
            padding: "10px 16px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: action ? "var(--radius-control)" : "var(--radius-pill)",
            boxShadow: "var(--elevation-3)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-secondary-size)",
            maxWidth: "90vw",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto", minWidth: 0 }}>
            {tone === "success" && <Icon name="check-circle" size={16} color="var(--success)" />}
            {tone === "error" && <Icon name="alert-circle" size={16} color="var(--danger)" />}
            <span id={messageId} aria-hidden="true" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{toast}</span>
          </div>
          {action && (
            <Button
              variant="secondary"
              size="sm"
              aria-describedby={messageId}
              onClick={(e) => {
                const btn = e.currentTarget;
                try {
                  action.run();
                } finally {
                  dismissToast();
                  const back = returnFocus.current;
                  returnFocus.current = null;
                  // Only if the action did not move focus elsewhere itself.
                  const active = document.activeElement;
                  const stillHere = !active || active === document.body || active === btn || !!box.current?.contains(active);
                  if (stillHere && back instanceof HTMLElement && back.isConnected) back.focus();
                }
              }}
            >
              {action.label}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
