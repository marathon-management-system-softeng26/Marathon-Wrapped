import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Per-request Auth client; never share user sessions across requests. */
export async function createSupabaseSession() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Authentication configuration is unavailable.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        // Auth routes and route handlers can persist refresh cookies. Server
        // Components cannot; they redirect through the authenticated route.
        for (const { name, value, options } of values) jar.set(name, value, options);
      },
    },
  });
}
