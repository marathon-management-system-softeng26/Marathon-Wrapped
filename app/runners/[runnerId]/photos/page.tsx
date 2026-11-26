import RunnerPhotoManager from "@/app/components/RunnerPhotoManager";

export const dynamic = "force-dynamic";

export default async function RunnerPhotos({ params }: { params: Promise<{ runnerId: string }> }) {
  const { runnerId } = await params;
  return <RunnerPhotoManager runnerId={runnerId} />;
}
