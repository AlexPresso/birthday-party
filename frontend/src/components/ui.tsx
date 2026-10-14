import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export function ErrorNotice({ message }: { message: string | null }) {
  return message ? (
    <p className="notice error-notice" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{message}</span>
    </p>
  ) : null;
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
      {action}
    </div>
  );
}
