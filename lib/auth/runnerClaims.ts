import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { AccessDeniedError, requireOrganizerAccess } from "@/lib/auth/access";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const INVALID_CLAIM = "This claim is invalid or no longer available.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeRpcError(error: { code?: string } | null, invalidIsAccess = false): never {
  if (error?.code === "42501" && invalidIsAccess) throw new AccessDeniedError();
  throw new Error("Runner claim service is unavailable.");
}

export async function createRunnerClaim(userId: string, eventId: number, runnerId: string): Promise<{ id: string; token: string; expiresAt: string }> {
  await requireOrganizerAccess(userId, eventId);
  if (!UUID_PATTERN.test(runnerId)) throw new AccessDeniedError();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin().rpc("create_runner_claim", {
    p_organizer: userId, p_event: eventId, p_runner: runnerId,
    p_hash: hashToken(token), p_expires_at: expiresAt,
  });
  if (error) safeRpcError(error, true);
  if (typeof data !== "string" || !UUID_PATTERN.test(data)) throw new Error("Runner claim service returned an invalid response.");
  return { id: data, token, expiresAt };
}

export async function consumeRunnerClaim(userId: string, token: string): Promise<"claimed" | "already_claimed_by_you"> {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new Error(INVALID_CLAIM);
  const { data, error } = await getSupabaseAdmin().rpc("consume_runner_claim", { p_user: userId, p_hash: hashToken(token) });
  if (error) throw new Error(INVALID_CLAIM);
  if (data === "claimed" || data === "already_claimed_by_you") return data;
  throw new Error(INVALID_CLAIM);
}

export async function revokeRunnerClaim(userId: string, eventId: number, runnerId: string, claimId: string): Promise<void> {
  await requireOrganizerAccess(userId, eventId);
  if (!UUID_PATTERN.test(runnerId) || !UUID_PATTERN.test(claimId)) throw new AccessDeniedError();
  const { data, error } = await getSupabaseAdmin().rpc("revoke_runner_claim", { p_organizer: userId, p_event: eventId, p_runner: runnerId, p_claim: claimId });
  if (error) throw new Error("Runner claim service is unavailable.");
  if (data !== true) throw new AccessDeniedError();
}

export const invalidRunnerClaimMessage = INVALID_CLAIM;
