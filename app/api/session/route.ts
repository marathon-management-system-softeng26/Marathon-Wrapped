import { requireUser, AuthenticationError } from "@/lib/auth/session";
import { getRunnerCatalog } from "@/lib/runnerCatalog";
import { privateHeaders } from "@/lib/authHttp";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await getRunnerCatalog(user.id), {
      headers: privateHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AuthenticationError
            ? "Sign in to find your race."
            : "Your races are temporarily unavailable. Please retry.",
      },
      {
        status: error instanceof AuthenticationError ? 401 : 503,
        headers: privateHeaders,
      },
    );
  }
}
