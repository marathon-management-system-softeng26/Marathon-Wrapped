import { bibResponse, finalizeBibSignup, readBibJson } from "@/lib/auth/bibRegistration";
import { sameOrigin } from "@/lib/authHttp";
import { createSupabaseSession } from "@/lib/supabaseSession";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open sign in from this application." }, 403);

  const body = await readBibJson(request, 8192);
  const { email, password } = body ?? {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 1024 ||
    !email.trim() ||
    !password
  ) {
    return bibResponse({ error: "Enter your email and password." }, 400);
  }

  try {
    const client = await createSupabaseSession();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (
      error &&
      (isAuthRetryableFetchError(error) ||
        error.status === 0 ||
        error.status === 429 ||
        (error.status ?? 0) >= 500)
    ) {
      throw new Error("Authentication unavailable");
    }
    if (error?.code === "email_not_confirmed")
      return bibResponse({ error: "Confirm your email before signing in." }, 403);
    if (error)
      return bibResponse({ error: "Sign in failed. Check your email and password, then retry." }, 401);
    if (!data.session || !data.user || data.session.user.id !== data.user.id)
      throw new Error("Authentication unavailable");
    if (!data.user.email_confirmed_at)
      return bibResponse({ error: "Confirm your email before signing in." }, 403);

    // This user came from Supabase Auth's password sign-in. SQL checks the current Auth
    // email and confirmation again before granting any access.
    await finalizeBibSignup(data.user.id);
    return bibResponse({ ok: true });
  } catch {
    return bibResponse({ error: "Sign in is unavailable. Please retry." }, 503);
  }
}
