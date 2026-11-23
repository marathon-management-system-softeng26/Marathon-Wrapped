import { useId, type ReactNode } from "react";

export default function AuthPanel({
  title,
  children,
  footer,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      className={`auth-panel${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      {footer ? <footer className="auth-panel-footer">{footer}</footer> : null}
    </section>
  );
}
