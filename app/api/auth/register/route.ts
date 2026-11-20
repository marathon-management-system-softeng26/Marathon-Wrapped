import {
  allowBibRequest,
  beginBibSignup,
  bibResponse,
  readAcceptedBibTicket,
  readBibJson,
} from "@/lib/auth/bibRegistration";
import { sameOrigin } from "@/lib/authHttp";
import { createSupabaseSession } from "@/lib/supabaseSession";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open registration from this application." }, 403);

  const body = await readBibJson(request, 8192);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body?.password;
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 1024
  ) {
    return bibResponse({ error: "Enter a valid email and a password of at least 8 characters." }, 400);
  }

  const ticket = readAcceptedBibTicket(request);
  if (!ticket) return bibResponse({ error: "Look up and confirm your BIB first." }, 409);

  try {
    if (!(await allowBibRequest(request, "submission"))) {
      return bibResponse({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
    }
    if (await beginBibSignup(ticket, email) !== "reserved") {
      return bibResponse({ error: "This BIB could not be reserved. Check your registration email or look up your BIB again." }, 409);
    }

    const client = await createSupabaseSession();
    const { data, error } = await client.auth.signUp({ email, password });

    if (
      error &&
      (isAuthRetryableFetchError(error) ||
        error.status === 0 ||
        error.status === 429 ||
        (error.status ?? 0) >= 500)
    ) {
      throw new Error("Authentication unavailable");
    }
    if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
      return bibResponse({ error: "Account creation failed. Check your details and try again." }, 400);
    }
    if (data.session) {
      // Email confirmation must be enabled in Supabase Auth.
      await client.auth.signOut({ scope: "local" });
      throw new Error("Email confirmation is unavailable");
    }

    return bibResponse({ ok: true, requiresEmailConfirmation: true }, 201);
  } catch {
    return bibResponse({ error: "Account creation is unavailable. Please retry." }, 503);
  }
}
