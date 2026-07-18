import type { ReactNode } from "react";

export function WidgetCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card widget">
      <div className="widget-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
