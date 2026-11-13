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
  title,
  description,
  inHeader = false,
  children,
}: {
  title: string;
  description?: string;
  /** Hide the title visually and lift its companions into the app header row. */
  inHeader?: boolean;
  children?: ReactNode;
}) {
  return (
    <header
      className={`page-heading${inHeader ? " page-heading-in-header" : ""}`}
    >
      <div>
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
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}
