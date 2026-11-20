import { describe, expect, it } from "vitest";
import { createScoreNowDirectoryFetcher, parseScoreNowCaptureManifest, scrapeScoreNow } from "@/lib/scorenow/scraper";

function resultRow(eventId: number, index: number, uid = `19723-308-${eventId}-${index}`) {
  const position = index + 1;
  return `<tr data-href="myresults.aspx?uid=${uid}">
    <td><span class="rtv3-pos">${position}</span></td>
    <td class="d-none d-sm-table-cell">${eventId}${String(index).padStart(5, "0")}</td>
    <td class="d-none d-sm-table-cell"><a class="grid-name">Runner ${eventId}-${index}</a></td>
    <td class="d-sm-none"><a class="grid-name">Runner duplicate</a></td>
    <td class="ltw-time">00:30:00.000</td><td class="d-sm-none">00:30:00.000</td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?g=1&amp;c=1">Umum</a><div class="rtv3-sub">${position} of 6000</div></td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?g=1">Male</a><div class="rtv3-sub">${position} of 6000</div></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">10:00.0</span></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">20:00.0</span></td>
  </tr>`;
}

function resultPage(eventId: number, pageNumber: number, totalPages: number, declaredTotal: number, rows: string[]) {
  return `<div id="ctl00_Content_Main_divV3ViewBar">${declaredTotal.toLocaleString("en-US")} results · page ${pageNumber} of ${totalPages}</div>
    <table id="ctl00_Content_Main_tblResults"><tr><td>Pos</td><td>Bib</td><td>Name</td><td>Time</td><td>Category</td><td>Gender</td><td>Checkpoint 1</td><td>Finish</td></tr>${rows.join("")}</table>`;
}

function completeFetcher(overrides: Map<string, string> = new Map()) {
  return async (url: string) => {
    const parsed = new URL(url);
    const eventId = Number(parsed.searchParams.get("EId"));
    const pageNumber = Number(parsed.searchParams.get("PageNo") ?? "1");
    const declaredTotal = eventId === 1 ? 3995 : 5987;
    const totalPages = eventId === 1 ? 80 : 120;
    const key = `${eventId}:${pageNumber}`;
    if (overrides.has(key)) return overrides.get(key)!;
    const start = (pageNumber - 1) * 50;
    const count = Math.min(50, declaredTotal - start);
    return resultPage(eventId, pageNumber, totalPages, declaredTotal, Array.from({ length: count }, (_, offset) => resultRow(eventId, start + offset)));
  };
}

const options = { scrapedAt: "2026-11-19T03:00:00.000Z", concurrency: 8, retryDelayMs: 0 };

describe("scrapeScoreNow", () => {
  it("loads a browser-captured page from the category and page URL", async () => {
    const reads: string[] = [];
    const fetcher = createScoreNowDirectoryFetcher(async (path) => {
      reads.push(path);
      return "captured html";
    }, "C:/capture");

    await expect(fetcher("https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=2&dt=0&PageNo=120")).resolves.toBe(
      "captured html",
    );
    expect(reads[0].replaceAll("\\", "/")).toBe("C:/capture/2-120.html");
    await expect(fetcher("https://example.com/results.aspx?EId=2&PageNo=1")).rejects.toThrow("Unexpected ScoreNow page URL");
  });

  it("collects all 80 10K and 120 5K pages in deterministic order", async () => {
    const dataset = await scrapeScoreNow(completeFetcher(), options);

    expect(dataset.totalResults).toBe(9982);
    expect(dataset.categories.map(({ category, declaredTotal, totalPages, results }) => ({ category, declaredTotal, totalPages, rows: results.length }))).toEqual([
      { category: "10K", declaredTotal: 3995, totalPages: 80, rows: 3995 },
      { category: "5K", declaredTotal: 5987, totalPages: 120, rows: 5987 },
    ]);
    expect(dataset.categories[0].results.at(-1)?.position).toBe(3995);
    expect(dataset.categories[1].results.at(-1)?.position).toBe(5987);
  });

  it("retries a transient page failure", async () => {
    const base = completeFetcher();
    let attempts = 0;
    const fetcher = async (url: string) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get("EId") === "1" && parsed.searchParams.get("PageNo") === "2" && attempts++ === 0) {
        throw new Error("temporary");
      }
      return base(url);
    };

    const dataset = await scrapeScoreNow(fetcher, options);
    expect(dataset.totalResults).toBe(9982);
    expect(attempts).toBe(2);
  });

  it("rejects a page whose number does not match the requested page", async () => {
    const overrides = new Map([["1:2", resultPage(1, 3, 80, 3995, Array.from({ length: 50 }, (_, index) => resultRow(1, 50 + index)))]]);
    await expect(scrapeScoreNow(completeFetcher(overrides), options)).rejects.toThrow("Requested page 2 but received page 3");
  });

  it("rejects a captured page whose result UIDs identify another event", async () => {
    const swapped = resultPage(2, 1, 80, 3995, Array.from({ length: 50 }, (_, index) => resultRow(2, index)));
    await expect(scrapeScoreNow(completeFetcher(new Map([["1:1", swapped]])), options)).rejects.toThrow(
      "Source UID does not match page context",
    );
  });

  it("rejects duplicate source UIDs", async () => {
    const duplicate = resultPage(1, 2, 80, 3995, [resultRow(1, 50, "19723-308-1-0"), ...Array.from({ length: 49 }, (_, index) => resultRow(1, 51 + index))]);
    await expect(scrapeScoreNow(completeFetcher(new Map([["1:2", duplicate]])), options)).rejects.toThrow("Duplicate source UID");
  });

  it("rejects a declared total that changes between pages", async () => {
    const mismatch = resultPage(2, 2, 120, 5986, Array.from({ length: 50 }, (_, index) => resultRow(2, 50 + index)));
    await expect(scrapeScoreNow(completeFetcher(new Map([["2:2", mismatch]])), options)).rejects.toThrow("Declared total changed");
  });

  it("accepts unranked rows at the end of a category", async () => {
    const rows = Array.from({ length: 45 }, (_, index) => resultRow(1, 3950 + index));
    rows[44] = rows[44]
      .replace('<span class="rtv3-pos">3995</span>', "")
      .replaceAll("00:30:00.000", "")
      .replaceAll(/<div class="rtv3-sub">[^<]+<\/div>/g, "");
    const finalPage = resultPage(1, 80, 80, 3995, rows);

    const dataset = await scrapeScoreNow(completeFetcher(new Map([["1:80", finalPage]])), options);
    expect(dataset.categories[0].results.at(-1)?.position).toBeNull();
  });

  it("requires a stable capture timestamp and exact page inventory in the capture manifest", () => {
    expect(
      parseScoreNowCaptureManifest({
        sourceUrl: "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308",
        capturedAt: "2026-11-19T03:23:05.244Z",
        categories: [
          { eventId: 1, pages: 80 },
          { eventId: 2, pages: 120 },
        ],
      }),
    ).toMatchObject({ capturedAt: "2026-11-19T03:23:05.244Z" });
    expect(() => parseScoreNowCaptureManifest({ capturedAt: "not-a-date" })).toThrow("capture manifest");
  });
});
