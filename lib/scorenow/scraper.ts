import { parseScoreNowPage } from "./parser.ts";
import type { ScoreNowCategoryDataset, ScoreNowDataset, ScoreNowPage, ScoreNowPageContext } from "./types.ts";
import { resolve } from "node:path";

export type ScoreNowFetchPage = (url: string) => Promise<string>;
export type ScoreNowReadText = (path: string) => Promise<string>;

export type ScoreNowScrapeOptions = {
  scrapedAt?: string;
  concurrency?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
};

export type ScoreNowCaptureManifest = {
  sourceUrl: typeof SOURCE_URL;
  capturedAt: string;
  categories: [{ eventId: 1; pages: 80 }, { eventId: 2; pages: 120 }];
};

const SOURCE_URL = "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308";
const CATEGORIES = [
  { eventId: 1, category: "10K" as const },
  { eventId: 2, category: "5K" as const },
];

export function parseScoreNowCaptureManifest(value: unknown): ScoreNowCaptureManifest {
  const candidate = value as Partial<ScoreNowCaptureManifest> | null;
  const capturedAt = candidate?.capturedAt;
  const categories = candidate?.categories;
  if (
    candidate?.sourceUrl !== SOURCE_URL ||
    typeof capturedAt !== "string" ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    new Date(capturedAt).toISOString() !== capturedAt ||
    !Array.isArray(categories) ||
    categories.length !== 2 ||
    categories[0]?.eventId !== 1 ||
    categories[0]?.pages !== 80 ||
    categories[1]?.eventId !== 2 ||
    categories[1]?.pages !== 120
  ) {
    throw new Error("Invalid ScoreNow capture manifest");
  }
  return candidate as ScoreNowCaptureManifest;
}

export function createScoreNowDirectoryFetcher(readText: ScoreNowReadText, directory: string): ScoreNowFetchPage {
  return async (url) => {
    const parsed = new URL(url);
    const eventId = parsed.searchParams.get("EId");
    const pageNumber = parsed.searchParams.get("PageNo") ?? "1";
    if (
      parsed.hostname !== "results.scorenow.co.id" ||
      parsed.searchParams.get("CId") !== "19723" ||
      parsed.searchParams.get("RId") !== "308" ||
      !["1", "2"].includes(eventId ?? "") ||
      !/^[1-9]\d*$/.test(pageNumber)
    ) {
      throw new Error(`Unexpected ScoreNow page URL: ${url}`);
    }
    return readText(resolve(directory, `${eventId}-${pageNumber}.html`));
  };
}

function pageUrl(eventId: number, pageNumber: number) {
  return `${SOURCE_URL}&EId=${eventId}&dt=0&PageNo=${pageNumber}`;
}

async function retry<T>(operation: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, transform: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await transform(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function validatePage(page: ScoreNowPage, expectedPage: number, firstPage: ScoreNowPage) {
  if (page.pageNumber !== expectedPage) throw new Error(`Requested page ${expectedPage} but received page ${page.pageNumber}`);
  if (page.totalPages !== firstPage.totalPages) throw new Error(`Total pages changed on page ${expectedPage}`);
  if (page.declaredTotal !== firstPage.declaredTotal) throw new Error(`Declared total changed on page ${expectedPage}`);
}

async function scrapeCategory(
  fetchPage: ScoreNowFetchPage,
  category: (typeof CATEGORIES)[number],
  scrapedAt: string,
  concurrency: number,
  retryAttempts: number,
  retryDelayMs: number,
): Promise<ScoreNowCategoryDataset> {
  const context = (pageNumber: number): ScoreNowPageContext => ({
    competitionId: 19723,
    raceId: 308,
    eventId: category.eventId,
    category: category.category,
    sourceUrl: pageUrl(category.eventId, pageNumber),
    scrapedAt,
  });
  const load = async (pageNumber: number) => {
    const url = pageUrl(category.eventId, pageNumber);
    const html = await retry(() => fetchPage(url), retryAttempts, retryDelayMs);
    return parseScoreNowPage(html, context(pageNumber));
  };

  const firstPage = await load(1);
  const pageNumbers = Array.from({ length: firstPage.totalPages - 1 }, (_, index) => index + 2);
  const remaining = await mapConcurrent(pageNumbers, concurrency, load);
  const pages = [firstPage, ...remaining];
  pages.forEach((page, index) => validatePage(page, index + 1, firstPage));
  const results = pages.flatMap((page) => page.results);
  if (results.length !== firstPage.declaredTotal) {
    throw new Error(`${category.category} row total mismatch: ${results.length}/${firstPage.declaredTotal}`);
  }
  let expectedPosition = 1;
  let reachedUnrankedResults = false;
  results.forEach((result, index) => {
    if (result.position === null) {
      reachedUnrankedResults = true;
      return;
    }
    if (reachedUnrankedResults || result.position !== expectedPosition) {
      throw new Error(`${category.category} position mismatch at row ${index + 1}: ${result.position}`);
    }
    expectedPosition += 1;
  });
  return { ...category, declaredTotal: firstPage.declaredTotal, totalPages: firstPage.totalPages, results };
}

export async function scrapeScoreNow(fetchPage: ScoreNowFetchPage, options: ScoreNowScrapeOptions = {}): Promise<ScoreNowDataset> {
  const scrapedAt = options.scrapedAt ?? new Date().toISOString();
  const concurrency = Math.max(1, Math.min(16, options.concurrency ?? 4));
  const retryAttempts = Math.max(1, Math.min(5, options.retryAttempts ?? 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const categories: ScoreNowCategoryDataset[] = [];
  for (const category of CATEGORIES) {
    categories.push(await scrapeCategory(fetchPage, category, scrapedAt, concurrency, retryAttempts, retryDelayMs));
  }

  const seen = new Set<string>();
  for (const result of categories.flatMap((category) => category.results)) {
    const key = `${result.raceId}:${result.eventId}:${result.sourceUid}`;
    if (seen.has(key)) throw new Error(`Duplicate source UID: ${result.sourceUid}`);
    seen.add(key);
  }
  const totalResults = categories.reduce((sum, category) => sum + category.results.length, 0);
  return {
    competitionId: 19723,
    raceId: 308,
    raceName: "Soekarno Run 2026",
    raceDate: "2026-02-15",
    sourceUrl: SOURCE_URL,
    scrapedAt,
    totalResults,
    categories,
  };
}

export async function fetchScoreNowPage(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Marathon-Wrapped/0.1 educational public-results importer",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ScoreNow returned HTTP ${response.status}`);
  return response.text();
}
