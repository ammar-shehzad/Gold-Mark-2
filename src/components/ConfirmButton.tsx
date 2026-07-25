"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Submit button that confirms before submitting (destructive actions), then
 * shows a spinner while the server action runs. Lives inside a server-action
 * <form>; useFormStatus reflects that form's in-flight state.
 */
export default function ConfirmButton({
  message,
  className,
  children,
  pendingText = "Deleting…",
}: {
  message: string;
  className?: string;
  children: ReactNode;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
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
