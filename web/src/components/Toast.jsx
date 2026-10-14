import React from "react";
import "./toast.css";

export function Toast({ toast, onDismiss }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="text-button"
              onClick={() => {
                toast.onAction?.();
                onDismiss();
              }}
            >
              {toast.action}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Notice({ tone = "clay", children, action, onAction, disabled }) {
  return (
    <div className="notice" data-tone={tone} role="alert">
      <span>{children}</span>
      {action && (
        <button className="text-button" onClick={onAction} disabled={disabled}>
          {action}
        </button>
      )}
    </div>
  );
}
