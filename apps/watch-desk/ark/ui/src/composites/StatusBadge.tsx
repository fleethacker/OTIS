/**
 * StatusBadge uses the app's semantic status theme tokens.
 * Verify text and surfaces in the rendered app; token names do not establish
 * accessibility conformance.
 *
 *   <StatusBadge status="success">Active</StatusBadge>
 *   <StatusBadge status="warning">Pending</StatusBadge>
 *   <StatusBadge status="error">Failed</StatusBadge>
 */
import type { ReactNode } from "react";

export type BadgeStatus = "success" | "warning" | "error";

export interface StatusBadgeProps {
  /** Semantic status selects the app's theme tokens. */
  status: BadgeStatus;
  children: ReactNode;
  /** Extra classes (e.g. sizing `badge-sm`, positioning). */
  className?: string;
}

// Full literals let Tailwind discover every semantic variant in shipped source.
const statusClasses: Record<BadgeStatus, string> = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
};

export function StatusBadge({ status, children, className }: StatusBadgeProps): React.JSX.Element {
  return (
    <span className={`badge ${statusClasses[status]}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
