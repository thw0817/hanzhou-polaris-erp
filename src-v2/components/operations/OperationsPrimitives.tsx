import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function OpsPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="ops-page__header">
      <div className="min-w-0">
        <p className="ops-page__eyebrow">{eyebrow}</p>
        <h1 className="ops-page__title">{title}</h1>
        <p className="ops-page__description">{description}</p>
      </div>
      {action ? <div className="ops-page__actions">{action}</div> : null}
    </header>
  );
}

export function OpsMetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("ops-metric-strip", className)}>{children}</section>;
}

export function OpsToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ops-toolbar", className)}>{children}</div>;
}

export function OpsTableShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ops-table-shell", className)}>{children}</div>;
}
