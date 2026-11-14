import "server-only";
import nodemailer from "nodemailer";

/**
 * Outbound SMTP for transactional mail. The relay is Brevo in the non-production
 * project, but nothing here is provider-specific: the same `SMTP_*` contract also
 * fills Supabase Auth custom SMTP, so confirmation mail and application mail leave
 * through one verified sender.
 */

// Fields are assigned rather than declared as parameter properties: scripts/send-test-mail.mts
// loads this module through node --experimental-strip-types, which rejects that syntax.
export class MailError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, status = 503, retryable = false) {
    super(`Mail: ${code}.`);
    this.name = "MailError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type MailSender = { name: string; address: string };

export type MailConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: MailSender;
  replyTo: string | null;
};

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** One mailbox and nothing else: no list, no display name, no header bytes. */
const mailbox = /^[^\s@,;:<>()[\]\\"]+@[^\s@,;:<>()[\]\\".]+(\.[^\s@,;:<>()[\]\\".]+)+$/;

const isAddress = (value: string) => value.length <= 254 && mailbox.test(value);

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new MailError("not_configured");
  }

  return value;
}

function address(name: string): string {
  const value = required(name);

  if (!isAddress(value)) {
    throw new MailError("not_configured");
  }

  return value;
}

function port(): number {
  const raw = required("SMTP_PORT");
  const value = /^\d+$/.test(raw) ? Number(raw) : 0;

  if (value < 1 || value > 65535) {
    throw new MailError("not_configured");
  }

  return value;
}

function displayName(): string {
  const value = process.env.MAIL_FROM_NAME?.trim() ?? "";

  // A name reaches the headers, so control bytes would be a header injection.
  if (value.length > 78 || /[\u0000-\u001f\u007f"]/.test(value)) {
    throw new MailError("not_configured");
  }

  return value;
}

function optionalAddress(name: string): string | null {
  const value = process.env[name]?.trim();

  if (!value) return null;
  if (!isAddress(value)) throw new MailError("not_configured");

  return value;
}

/** Read and check the SMTP contract. Call at startup to fail before the first send. */
export function validateMailConfiguration(): MailConfiguration {
  const smtpPort = port();

  return {
    host: required("SMTP_HOST"),
    port: smtpPort,
    secure: smtpPort === 465,
    user: required("SMTP_USER"),
    password: required("SMTP_PASSWORD"),
    from: { name: displayName(), address: address("MAIL_FROM_ADDRESS") },
    replyTo: optionalAddress("MAIL_REPLY_TO"),
  };
}

const createTransport = (config: MailConfiguration) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    // A Vercel handler is capped, so never let a silent relay own the whole budget.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { minVersion: "TLSv1.2" },
  });

type Transport = ReturnType<typeof createTransport>;

let cached: { fingerprint: string; transport: Transport } | null = null;

/** Drop the pooled transport. Used by tests and after a connection-level fault. */
export function resetMailTransport() {
  cached = null;
}

function transportFor(config: MailConfiguration): Transport {
  const fingerprint = `${config.host}:${config.port}:${config.user}`;

  if (cached?.fingerprint === fingerprint) return cached.transport;

  cached = { fingerprint, transport: createTransport(config) };

  return cached.transport;
}

function envelope(mail: OutgoingMail) {
  const to = mail.to?.trim() ?? "";
  const subject = mail.subject?.trim() ?? "";

  if (!isAddress(to)) throw new MailError("invalid_recipient", 400);
  if (!subject || /[\r\n]/.test(subject) || subject.length > 200) throw new MailError("invalid_subject", 400);
  if (!mail.text?.trim()) throw new MailError("invalid_body", 400);

  return { to, subject };
}

/** SMTP replies that mean the relay, not this message, is the problem. */
function classify(cause: unknown): MailError {
  const fault = cause as { responseCode?: number; code?: string } | null;
  const reply = typeof fault?.responseCode === "number" ? fault.responseCode : 0;
  const code = typeof fault?.code === "string" ? fault.code : "";

  if (reply === 535 || reply === 534 || reply === 530 || code === "EAUTH") {
    return new MailError("not_authenticated");
  }
  if (reply === 421 || reply === 450 || reply === 451 || reply === 452) {
    resetMailTransport();
    return new MailError("rate_limited", 503, true);
  }
  if (reply >= 500) {
    return new MailError("delivery_failed");
  }

  // No usable reply code: the socket, DNS, or TLS failed. Reconnect on the next send.
  resetMailTransport();

  return new MailError("connection_failed", 503, true);
}

/**
 * Send one message. The relay's own text is never re-thrown — an SMTP failure echoes
 * the recipient and sometimes the credential, and this error reaches logs.
 */
export async function sendMail(mail: OutgoingMail): Promise<{ messageId: string }> {
  const config = validateMailConfiguration();
  const { to, subject } = envelope(mail);

  const message = {
    from: config.from,
    to,
    subject,
    text: mail.text,
    ...(mail.html === undefined ? {} : { html: mail.html }),
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
  };

  let info: { messageId?: string; rejected?: unknown[] };

  try {
    info = await transportFor(config).sendMail(message);
  } catch (cause) {
    const failure = classify(cause);
    console.error(`mail send failed: ${failure.code}`);
    throw failure;
  }

  if (info.rejected?.length) {
    console.error("mail send failed: delivery_failed");
    throw new MailError("delivery_failed");
  }

  return { messageId: String(info.messageId ?? "") };
}
