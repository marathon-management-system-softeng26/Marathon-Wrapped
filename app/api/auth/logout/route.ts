import { createSupabaseSession } from "@/lib/supabaseSession";
import { privateHeaders, sameOrigin } from "@/lib/authHttp";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Open this action from the application." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const client = await createSupabaseSession();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch {
    return Response.json(
      { error: "Sign out failed. Please retry." },
      { status: 503, headers: privateHeaders },
    );
  }
}
