import RecapStory from "@/app/components/RecapStory";
export default async function Recap({
  params,
}: {
  params: Promise<{ runnerId: string }>;
}) {
  const { runnerId } = await params;
  return <RecapStory runnerId={runnerId} />;
}
