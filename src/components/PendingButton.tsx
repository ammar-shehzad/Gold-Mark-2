"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Submit button that shows an immediate spinner + label while its parent
 * server-action <form> is in flight. Server actions render nothing until
 * they redirect, so without this the button looks frozen on slow networks.
 * useFormStatus reads the enclosing form's pending state, so this must live
 * inside the <form> it submits.
 */
export default function PendingButton({
  children,
  pendingText = "Working…",
  className = "btn small",
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <span className="btn-spin-wrap">
          <span className="btn-spinner" aria-hidden="true" />
          {pendingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
