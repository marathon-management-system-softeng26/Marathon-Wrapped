import { createSupabaseSession } from "@/lib/supabaseSession";
import { privateHeaders, sameOrigin } from "@/lib/authHttp";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Open sign in from this application." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const { email, password } = await request.json();
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 1024 ||
      !email.trim() ||
      !password
    )
      return Response.json(
        { error: "Enter your email and password." },
        { status: 400, headers: privateHeaders },
      );
    const client = await createSupabaseSession();
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (
      error &&
      (isAuthRetryableFetchError(error) ||
        error.status === 0 ||
        error.status === 429 ||
        (error.status ?? 0) >= 500)
    )
      throw new Error("Authentication unavailable");
    if (error)
      return Response.json(
        { error: "Sign in failed. Check your email and password, then retry." },
        { status: 401, headers: privateHeaders },
      );
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch {
    return Response.json(
      { error: "Sign in is unavailable. Please retry." },
      { status: 503, headers: privateHeaders },
    );
  }
}
