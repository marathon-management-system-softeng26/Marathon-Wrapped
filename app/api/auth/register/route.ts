import { privateHeaders, sameOrigin } from "@/lib/authHttp";
import { createSupabaseSession } from "@/lib/supabaseSession";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json(
      { error: "Open registration from this application." },
      { status: 403, headers: privateHeaders },
    );
  }

  try {
    const { email, password } = await request.json();
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 1024 ||
      !email.trim() ||
      password.length < 8
    ) {
      return Response.json(
        { error: "Enter a valid email and a password of at least 8 characters." },
        { status: 400, headers: privateHeaders },
      );
    }

    const client = await createSupabaseSession();
    const { data, error } = await client.auth.signUp({
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

    if (error) {
      return Response.json(
        { error: "Account creation failed. Check your details and try again." },
        { status: 400, headers: privateHeaders },
      );
    }

    const requiresEmailConfirmation = !data.session;
    return Response.json(
      { ok: true, requiresEmailConfirmation },
      {
        status: requiresEmailConfirmation ? 201 : 200,
        headers: privateHeaders,
      },
    );
  } catch {
    return Response.json(
      { error: "Account creation is unavailable. Please retry." },
      { status: 503, headers: privateHeaders },
    );
  }
}
