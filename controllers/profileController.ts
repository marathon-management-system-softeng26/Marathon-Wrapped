import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/** A failure the runner can act on, with the status the route should answer. */
export class ProfileError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProfileError";
    this.status = status;
  }
}

const BIB_PATTERN = /^[A-Za-z0-9-]{1,40}$/;
const NAME_LIMIT = 120;

/**
 * One message for every way a BIB can fail to link. An absent BIB, a BIB owned by someone else
 * and a BIB that lost a race to another request are deliberately indistinguishable, so a response
 * never confirms which BIBs exist.
 */
export const unavailableBibMessage =
  "That BIB is not available to add. Check it with your race organizer.";

export async function getProfileName(userId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("runner_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Your profile is temporarily unavailable.");
  return data?.display_name ?? null;
}

export async function saveProfileName(
  userId: string,
  name: unknown,
): Promise<string> {
  if (typeof name !== "string")
    throw new ProfileError("Enter a display name.", 400);
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > NAME_LIMIT)
    throw new ProfileError(
      `Enter a display name of 1 to ${NAME_LIMIT} characters.`,
      400,
    );
  const { data, error } = await getSupabaseAdmin().rpc(
    "upsert_runner_profile",
    { p_user: userId, p_name: cleaned },
  );
  if (error) throw new Error("Your profile could not be saved. Please retry.");
  if (typeof data !== "string")
    throw new Error("Profile management returned an invalid response.");
  return data;
}

export type BibLinkOutcome = "linked" | "already_yours";

/**
 * Take an unclaimed registration by its BIB. The database decides: this checks only the shape, so
 * a malformed entry never becomes a query, and translates the single refusal code into one message.
 */
export async function linkRegistrationByBib(
  userId: string,
  bib: unknown,
): Promise<BibLinkOutcome> {
  if (typeof bib !== "string" || !BIB_PATTERN.test(bib.trim()))
    throw new ProfileError(unavailableBibMessage, 400);
  const { data, error } = await getSupabaseAdmin().rpc("link_runner_by_bib", {
    p_user: userId,
    p_bib: bib.trim(),
  });
  if (error)
    throw new Error("Adding a BIB is temporarily unavailable. Please retry.");
  if (data === "linked" || data === "already_yours") return data;
  if (data === "throttled")
    throw new ProfileError(
      "Too many tries. Wait a few minutes before adding another BIB.",
      429,
    );
  throw new ProfileError(unavailableBibMessage, 400);
}
