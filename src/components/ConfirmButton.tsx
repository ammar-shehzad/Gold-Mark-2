"use client";
import type { ReactNode } from "react";

/**
 * Submit button that asks for confirmation first - used for destructive
 * actions (delete shop/owner). Sits inside a server-action <form>; if the
 * user cancels, the submit is prevented and nothing happens.
 */
export default function ConfirmButton({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
