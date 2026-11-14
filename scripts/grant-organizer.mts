import { loadEnvFile } from "node:process";
import { grantOrganizerAccessByEmail, OrganizerGrantError } from "../lib/auth/grantOrganizer.ts";

try {
  const args = process.argv.slice(2);
  const flags = new Map([[args[0], args[1]], [args[2], args[3]]]);
  const email = flags.get("--email");
  const eventIdText = flags.get("--event-id");
  if (args.length !== 4 || !email || !eventIdText) {
    throw new OrganizerGrantError("Usage: npm run --silent grant:organizer -- --email <email> --event-id <id>");
  }

  try {
    loadEnvFile(".env.local");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw new OrganizerGrantError("Could not load .env.local.", { cause: error });
    }
  }

  const eventId = /^\d+$/.test(eventIdText) ? Number(eventIdText) : NaN;
  const grant = await grantOrganizerAccessByEmail(email, eventId);
  console.log(`Organizer access granted for user ${grant.userId} and event ${grant.eventId}.`);
} catch (error) {
  console.error(error instanceof OrganizerGrantError ? error.message : "Could not grant organizer access.");
  process.exitCode = 1;
}
