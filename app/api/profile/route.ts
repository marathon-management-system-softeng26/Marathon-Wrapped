import { AuthenticationError, requireUser } from "@/lib/auth/session";
import { boundedJson, privateHeaders, sameOrigin } from "@/lib/authHttp";
import { ProfileError, getProfileName, saveProfileName } from "@/controllers/profileController";

export const dynamic = "force-dynamic";

const errorResponse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: privateHeaders });

function failure(cause: unknown, unavailable: string) {
  if (cause instanceof AuthenticationError) return errorResponse(cause.message, 401);
  if (cause instanceof ProfileError) return errorResponse(cause.message, cause.status);
  return errorResponse(unavailable, 503);
}

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(
      { display_name: await getProfileName(user.id), email: user.email },
      { headers: privateHeaders },
    );
  } catch (cause) {
    return failure(cause, "Your profile is temporarily unavailable. Please retry.");
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return errorResponse("Open this action from the application.", 403);
  try {
    const user = await requireUser();
    let body: unknown;
    try { body = await boundedJson(request); } catch { return errorResponse("Enter a display name.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Enter a display name.", 400);
    const display_name = await saveProfileName(user.id, (body as Record<string, unknown>).display_name);
    return Response.json({ display_name }, { headers: privateHeaders });
  } catch (cause) {
    return failure(cause, "Your profile could not be saved. Please retry.");
  }
}
