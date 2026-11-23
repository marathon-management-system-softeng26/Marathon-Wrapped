import type { ReactNode } from "react";

export default function RunnerFeedback({
  kind,
  title,
  children,
}: {
  kind: "status" | "error" | "empty";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`runner-feedback runner-feedback-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      {children}
    </div>
  );
}
