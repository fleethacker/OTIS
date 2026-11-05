import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from "react";
import { StatusBadge } from "@defense-unicorns/ark-ui";
import { recordStatus } from "./message-format";

const buttonVariants = {
  secondary: "",
  primary: "btn-primary",
  outline: "btn-outline",
  ghost: "btn-ghost",
};
const buttonSizes = { xs: "btn-xs", sm: "btn-sm", md: "" };

/** Shared daisyUI atoms keep semantics, refs, and native browser behavior intact. */
export function AppButton({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`btn app-button ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    />
  );
}

export function TextInput({ className = "", ...props }: ComponentPropsWithRef<"input">) {
  return <input {...props} className={`input app-input ${className}`} />;
}

export function SelectInput({ className = "", ...props }: ComponentPropsWithRef<"select">) {
  return <select {...props} className={`select app-select ${className}`} />;
}

export function TextArea({ className = "", ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={`textarea app-textarea ${className}`} />;
}

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

const noticeClasses = {
  info: "notice-info",
  warning: "notice-warning",
  error: "notice-error",
  success: "notice-success",
};

export function Notice({
  tone = "info",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof noticeClasses }) {
  return <div {...props} className={`app-notice ${noticeClasses[tone]} ${className}`} />;
}

export function RecordStatus({
  value,
  children,
  className = "",
}: {
  value: string;
  children?: ReactNode;
  className?: string;
}) {
  const label = children ?? recordStatus(value);
  const classes = `record-status ${className}`;
  if (value === "updated" || value === "needs_review") {
    return (
      <StatusBadge status="warning" className={classes}>
        {label}
      </StatusBadge>
    );
  }
  // Parsed describes extraction, not human confirmation or operational readiness.
  return <span className={`badge badge-outline ${classes}`}>{label}</span>;
}

export function RevisionBadge() {
  return (
    <StatusBadge status="warning" className="revision">
      Revised
    </StatusBadge>
  );
}
