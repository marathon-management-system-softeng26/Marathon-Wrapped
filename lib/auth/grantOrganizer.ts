import "server-only";
import { getSupabaseAdmin } from "../supabaseServer.ts";
import type { User } from "@supabase/supabase-js";

export class OrganizerGrantError extends Error {}

const emailLocalPart = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const emailDomain = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export async function grantOrganizerAccessByEmail(
  email: string,
  eventId: number,
): Promise<{ userId: string; eventId: number }> {
  const [localPart, domain, extra] = email.split("@");
  if (email.length > 254 || localPart.length > 64 || !domain || extra !== undefined ||
      !emailLocalPart.test(localPart) || !emailDomain.test(domain)) {
    throw new OrganizerGrantError("Enter a valid email address.");
  }
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    throw new OrganizerGrantError("The event ID must be a positive safe integer.");
  }

  const ref = process.env.SUPABASE_DEMO_PROJECT_REF;
  const url = process.env.SUPABASE_URL;
  const projectUrl = `https://${ref}.supabase.co`;
  if (!ref || !/^[a-z0-9]+$/.test(ref) || (url !== projectUrl && url !== `${projectUrl}/`)) {
    throw new OrganizerGrantError("SUPABASE_DEMO_PROJECT_REF must match the dedicated SUPABASE_URL.");
  }

  const db = getSupabaseAdmin();
  const address = email.toLowerCase();
  const perPage = 50;
  const seen = new Set<string>();
  const incompleteScan = "Incomplete Auth user scan. Retry the grant.";
  let total: number | undefined;
  let match: User | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new OrganizerGrantError("Could not look up Auth users.");
    // Count distinct IDs against the total because offset pages can overlap.
    total ??= data.total;
    if (!Number.isSafeInteger(total) || total < 0 || data.total !== total ||
        data.users.length !== Math.min(perPage, total - seen.size)) {
      throw new OrganizerGrantError(incompleteScan);
    }
    for (const user of data.users) {
      if (typeof user.id !== "string" || !user.id || seen.has(user.id)) {
        throw new OrganizerGrantError(incompleteScan);
      }
      seen.add(user.id);
      if (user.email?.toLowerCase() !== address) continue;
      if (match) throw new OrganizerGrantError("Multiple Auth users match that email address.");
      match = user;
    }
    if (seen.size === total) break;
  }
  if (!match) throw new OrganizerGrantError("No Auth user matches that email address.");
  if (!match.email_confirmed_at) {
    throw new OrganizerGrantError("The Auth user must confirm their email before receiving organizer access.");
  }

  const { data: event, error: eventError } = await db.from("events")
    .select("id").eq("id", eventId).maybeSingle();
  if (eventError) throw new OrganizerGrantError("Could not look up the event.");
  if (!event) throw new OrganizerGrantError("The event was not found.");

  const { error: grantError } = await db.from("organizer_access").upsert(
    { user_id: match.id, event_id: eventId },
    { onConflict: "user_id,event_id", ignoreDuplicates: true },
  );
  if (grantError) throw new OrganizerGrantError("Could not grant organizer access.");
  return { userId: match.id, eventId };
}
