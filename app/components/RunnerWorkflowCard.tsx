import type { CatalogRunner } from "@/lib/runnerCatalog";
import RacePassCard from "./RacePassCard";

export default function RunnerWorkflowCard({ runner }: { runner: CatalogRunner }) {
  return <RacePassCard runner={runner} />;
}
