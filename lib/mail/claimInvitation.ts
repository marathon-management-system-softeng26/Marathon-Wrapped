import "server-only";
import { MailError, sendMail } from "./mailer";

/**
 * The claim invitation a runner receives when an organizer issues their one-time code.
 * The message carries both a link and the raw token: the link is one click, and the
 * token still works for anyone whose mail client mangles or strips links.
 */

export type ClaimInvitation = {
  to: string;
  runnerName: string;
  eventName: string | null;
  token: string;
  expiresAt: string;
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => escapes[char]);

/** Names reach a Subject header, where a newline would start a header of its own. */
const oneLine = (value: string, limit = 120) => value.replace(/\s+/g, " ").trim().slice(0, limit);

/**
 * The public application origin. Checked like `stravaCallbackUrl`: the claim link is
 * the one URL a runner is asked to trust, so it is never assembled from a loose value.
 */
export function appUrl(): URL {
  let url: URL;

  try {
    url = new URL(process.env.APP_URL?.trim() ?? "");
  } catch {
    throw new MailError("not_configured");
  }

  const local =
    ["localhost", "127.0.0.1"].includes(url.hostname) && process.env.NODE_ENV !== "production";

  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new MailError("not_configured");
  }

  return url;
}

/** The one-click claim target. `RunnerClaimForm` reads the token from this query. */
export function claimUrl(token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new MailError("invalid_token", 400);
  }

  return `${appUrl().origin}/?claim=${token}`;
}

function expiry(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new MailError("invalid_expiry", 400);
  }

  const when = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Jakarta",
  }).format(date);

  return `${when} WIB`;
}

export function claimInvitationMessage(invitation: ClaimInvitation): {
  subject: string;
  text: string;
  html: string;
} {
  const link = claimUrl(invitation.token);
  const when = expiry(invitation.expiresAt);
  const event = invitation.eventName ? oneLine(invitation.eventName) : "";
  const runner = oneLine(invitation.runnerName);
  const race = event || "Your race";

  const subject = event ? `Claim your ${event} registration` : "Claim your race registration";
  const greeting = runner ? `Hi ${runner},` : "Hi,";

  const text = [
    greeting,
    "",
    `${race} has a Marathon Wrapped showcase waiting for you.`,
    "",
    "Open this link and sign in to claim your registration:",
    link,
    "",
    'Or sign in, then paste this code into "Claim a race registration":',
    invitation.token,
    "",
    `The code works once and expires ${when}.`,
    "",
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${escapeHtml(race)} has a Marathon Wrapped showcase waiting for you.</p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#1c1c1a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Claim my registration</a>
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">If the button does not work, sign in and paste this code into &ldquo;Claim a race registration&rdquo;:</p>
    <p style="margin:0 0 24px;padding:12px;background:#f6f6f4;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;word-break:break-all;">${escapeHtml(invitation.token)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#56564f;">The code works once and expires ${escapeHtml(when)}.</p>
    <p style="margin:0;font-size:14px;color:#56564f;">If you were not expecting this, you can ignore this message.</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/** Compose and send. Throws `MailError` on a configuration or relay fault. */
export async function sendClaimInvitation(invitation: ClaimInvitation): Promise<void> {
  const { subject, text, html } = claimInvitationMessage(invitation);

  await sendMail({ to: invitation.to, subject, text, html });
}
