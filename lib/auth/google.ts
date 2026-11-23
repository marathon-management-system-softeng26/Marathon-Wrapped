import { createSupabaseBrowser } from "@/lib/supabaseBrowser";

export async function startGoogleSignIn() {
  const client = createSupabaseBrowser();
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  return error;
}
