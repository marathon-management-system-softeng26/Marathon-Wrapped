import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "@/lib/auth/session";
import OrganizerPanel from "../components/OrganizerPanel";

// Per-event authorization stays in the API routes; this only keeps the console out of
// a signed-out browser. An auth outage must not read as "signed out", so it still renders.
export const dynamic = "force-dynamic";

export default async function Organizer() {
  try {
    await requireUser();
  } catch (cause) {
    if (cause instanceof AuthenticationError) redirect("/login");
  }
  return <OrganizerPanel />;
}
