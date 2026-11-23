import {
  AuthenticationError,
  requireUser,
} from "@/lib/auth/session";
import { boundedJson, privateHeaders, sameOrigin } from "@/lib/authHttp";
import {
  ProfileError,
  linkRegistrationByBib,
  releaseRegistrationByBib,
  unavailableBibMessage,
  unreleasableBibMessage,
} from "@/controllers/profileController";

export const dynamic = "force-dynamic";

const errorResponse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: privateHeaders });

function failure(cause: unknown, unavailable: string) {
  if (cause instanceof AuthenticationError) return errorResponse(cause.message, 401);
  // Signed in but unconfirmed: 403, because signing in again would not help.
  if (cause instanceof ProfileError) return errorResponse(cause.message, cause.status);
  return errorResponse(unavailable, 503);
}

/** Reads the BIB out of a bounded body, or null when the body is not usable. */
async function readBib(request: Request): Promise<string | null | undefined> {
  let body: unknown;
  try { body = await boundedJson(request); } catch { return undefined; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).bib_number;
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    const bib = await readBib(request);
    if (bib === undefined) return errorResponse(unavailableBibMessage, 400);
    const status = await linkRegistrationByBib(user.id, bib);
    return Response.json({ status }, { headers: privateHeaders });
  } catch (cause) {
    return failure(cause, "Adding a BIB is temporarily unavailable. Please retry.");
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return errorResponse("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    const bib = await readBib(request);
    if (bib === undefined) return errorResponse(unreleasableBibMessage, 400);
    const status = await releaseRegistrationByBib(user.id, bib);
    return Response.json({ status }, { headers: privateHeaders });
  } catch (cause) {
    return failure(cause, "Removing a BIB is temporarily unavailable. Please retry.");
  }
}
