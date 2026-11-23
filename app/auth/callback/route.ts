import { createSupabaseSession } from "@/lib/supabaseSession";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return Response.redirect(new URL("/login?error=oauth_callback_failed", url.origin));
  }

  try {
    const client = await createSupabaseSession();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return Response.redirect(new URL(next, url.origin));
  } catch {
    return Response.redirect(new URL("/login?error=oauth_callback_failed", url.origin));
  }
}
