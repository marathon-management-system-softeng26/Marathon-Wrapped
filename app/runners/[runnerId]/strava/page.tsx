import RunnerStravaSetup from "@/app/components/RunnerStravaSetup";

export const dynamic = "force-dynamic";

export default async function RunnerStrava({
  params,
  searchParams,
}: {
  params: Promise<{ runnerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runnerId } = await params;
  // One repeated parameter is ambiguous feedback, so only a single code is read.
  const code = (await searchParams).strava;
  return <RunnerStravaSetup runnerId={runnerId} feedbackCode={typeof code === "string" ? code : null} />;
}
