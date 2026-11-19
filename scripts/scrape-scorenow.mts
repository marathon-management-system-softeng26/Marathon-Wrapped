import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createScoreNowDirectoryFetcher, fetchScoreNowPage, scrapeScoreNow } from "../lib/scorenow/scraper.ts";

const target = resolve(".data/scorenow/soekarno-run-2026.json");
const temporary = `${target}.${process.pid}.tmp`;
const pagesDirectory = resolve(".data/scorenow/pages");

try {
  let fetchPage = fetchScoreNowPage;
  try {
    await access(pagesDirectory);
    fetchPage = createScoreNowDirectoryFetcher((path) => readFile(path, "utf8"), pagesDirectory);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const dataset = await scrapeScoreNow(fetchPage);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(dataset, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  const summary = dataset.categories.map((category) => `${category.category}=${category.results.length}`).join(", ");
  console.log(`Scraped ${dataset.totalResults} validated ScoreNow results (${summary}) to ${target}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "ScoreNow scrape failed.");
  process.exitCode = 1;
}
