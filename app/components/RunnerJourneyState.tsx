import type { ReactNode } from "react";

export default function RunnerJourneyState({ state, title, body, action, tone = "default" }: {
  state: string;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  tone?: "default" | "waiting" | "recovery" | "success";
}) {
  return (
    <section className={`runner-journey-state runner-journey-${tone}`} data-state={state} aria-labelledby={`journey-${state}`}>
      <div className="runner-journey-route" aria-hidden="true" />
      <h3 id={`journey-${state}`}>{title}</h3>
      <div className="runner-journey-body">{body}</div>
      {action && <div className="runner-journey-action">{action}</div>}
    </section>
  );
}
