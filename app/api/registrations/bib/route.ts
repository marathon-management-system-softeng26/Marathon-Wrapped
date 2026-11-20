import { AuthenticationError, requireUser } from "@/lib/auth/session";
import { boundedJson, privateHeaders, sameOrigin } from "@/lib/authHttp";
import { ProfileError, linkRegistrationByBib, unavailableBibMessage } from "@/controllers/profileController";

export const dynamic = "force-dynamic";

const errorResponse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: privateHeaders });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    let body: unknown;
    try { body = await boundedJson(request); } catch { return errorResponse(unavailableBibMessage, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse(unavailableBibMessage, 400);
    const status = await linkRegistrationByBib(user.id, (body as Record<string, unknown>).bib_number);
    return Response.json({ status }, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof AuthenticationError) return errorResponse(cause.message, 401);
    if (cause instanceof ProfileError) return errorResponse(cause.message, cause.status);
    return errorResponse("Adding a BIB is temporarily unavailable. Please retry.", 503);
  }
}
