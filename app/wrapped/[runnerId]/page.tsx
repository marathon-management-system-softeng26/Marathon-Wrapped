import RecapStory from "@/app/components/RecapStory";
import { requireUser } from "@/lib/auth/session";
import { getWrappedPayloadForUser } from "@/lib/wrappedRouteService";

export const dynamic = "force-dynamic";

export default async function Recap({
  params,
}: {
  params: Promise<{ runnerId: string }>;
}) {
  const { runnerId } = await params;
  let initialPayload = null;
  try {
    const user = await requireUser();
    initialPayload = await getWrappedPayloadForUser(user.id, runnerId.toLowerCase());
  } catch {
    // The client request retains the existing sign-in and retry behavior.
  }
  return <RecapStory runnerId={runnerId} initialPayload={initialPayload} />;
}
