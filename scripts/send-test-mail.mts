import { loadEnvFile } from "node:process";
// Imported past lib/mail/index.ts: bare Node resolves no extensionless specifier.
import { MailError, sendMail, validateMailConfiguration } from "../lib/mail/mailer.ts";

/**
 * Prove the SMTP contract in `.env.local` reaches a real mailbox before any feature
 * depends on it. Sends one plain message and reports the relay's message id.
 */

const usage = "Usage: npm run --silent mail:test -- --to <address>";

try {
  const args = process.argv.slice(2);
  const to = new Map([[args[0], args[1]]]).get("--to");

  if (args.length !== 2 || !to) {
    throw new MailError("usage", 400);
  }

  try {
    loadEnvFile(".env.local");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw new MailError("not_configured");
    }
  }

  const config = validateMailConfiguration();
  console.log(`Relay ${config.host}:${config.port} (${config.secure ? "implicit TLS" : "STARTTLS"}) as ${config.user}.`);
  console.log(`Sender ${config.from.name ? `${config.from.name} <${config.from.address}>` : config.from.address}.`);

  const sent = await sendMail({
    to,
    subject: "Marathon Wrapped SMTP check",
    text: "The Marathon Wrapped relay is configured. No action is needed.",
  });

  console.log(`Accepted by the relay as ${sent.messageId || "an unreported message id"}.`);
} catch (error) {
  const code = error instanceof MailError ? error.code : "unknown";

  console.error(
    code === "usage"
      ? usage
      : code === "not_configured"
        ? `SMTP is not configured. Set the SMTP_* and MAIL_FROM_* variables in .env.local — see the SMTP section of README.md.`
        : `The relay refused the message (${code}). Check the Brevo SMTP credentials and the verified sender.`,
  );
  process.exitCode = 1;
}
