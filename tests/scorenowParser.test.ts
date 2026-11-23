import { describe, expect, it } from "vitest";
import { parseScoreNowPage } from "@/lib/scorenow/parser";
import type { ScoreNowPageContext } from "@/lib/scorenow/types";

const context: ScoreNowPageContext = {
  competitionId: 19723,
  raceId: 308,
  eventId: 1,
  category: "10K",
  sourceUrl: "https://results.scorenow.co.id/results.aspx?CId=19723&RId=308&EId=1&dt=0&PageNo=1",
  scrapedAt: "2026-11-19T03:00:00.000Z",
};

function page(row: string, options: { summary?: string; checkpoints?: string[] } = {}) {
  const checkpoints = options.checkpoints ?? ["Checkpoint 1 - KM 3.7", "Checkpoint 2 - KM 8.3", "Finish"];
  return `
    <div id="ctl00_Content_Main_divV3ViewBar">${options.summary ?? "3,995 results · page 1 of 80"}</div>
    <table id="ctl00_Content_Main_tblResults">
      <tr>
        <td>Pos</td><td>Bib No</td><td>Name</td><td class="ltw-time">Time</td>
        <td>Category</td><td>Gender</td>
        ${checkpoints.map((label) => `<td class="rtv3-splitcell">${label}</td>`).join("")}
      </tr>
      ${row}
    </table>`;
}

const tenKilometerRow = `
  <tr data-href="myresults.aspx?uid=19723-308-1-fixture-001">
    <td><span class="rtv3-pos">1</span></td>
    <td class="d-none d-sm-table-cell">T10001</td>
    <td class="d-none d-sm-table-cell"><a class="grid-name"> SYNTHETIC&nbsp; RUNNER </a></td>
    <td class="d-sm-none"><a class="grid-name">SYNTHETIC RUNNER T10001</a></td>
    <td class="ltw-time">00:40:00.000</td><td class="d-sm-none">00:40:00.000</td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?CId=19723&amp;RId=308&amp;EId=1&amp;g=1&amp;c=1">Top 3 Umum</a><div class="rtv3-sub">1 of 3</div></td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?CId=19723&amp;RId=308&amp;EId=1&amp;g=1">Male</a><div class="rtv3-sub">1 of 2,100</div></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">14:00.0</span></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">20:00.0</span></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">6:00.0</span></td>
  </tr>`;

describe("parseScoreNowPage", () => {
  it("parses the result summary when the view bar contains nested controls", () => {
    const html = page(tenKilometerRow).replace(
      '<div id="ctl00_Content_Main_divV3ViewBar">3,995 results · page 1 of 80</div>',
      '<div id="ctl00_Content_Main_divV3ViewBar"><div><a>Advanced</a></div><span>3,995 results · page 1 of 80</span></div>',
    );

    expect(parseScoreNowPage(html, context)).toMatchObject({ declaredTotal: 3995, pageNumber: 1, totalPages: 80 });
  });

  it("parses the desktop 10K cells without duplicating responsive values", () => {
    const parsed = parseScoreNowPage(page(tenKilometerRow), context);

    expect(parsed).toMatchObject({ declaredTotal: 3995, pageNumber: 1, totalPages: 80 });
    expect(parsed.results).toEqual([
      {
        competitionId: 19723,
        raceId: 308,
        eventId: 1,
        sourceUid: "19723-308-1-fixture-001",
        category: "10K",
        position: 1,
        bibNumber: "T10001",
        name: "SYNTHETIC RUNNER",
        status: null,
        officialTime: "00:40:00.000",
        officialTimeMilliseconds: 2_400_000,
        categoryName: "Top 3 Umum",
        categoryRank: 1,
        categoryTotal: 3,
        gender: "Male",
        genderRank: 1,
        genderTotal: 2100,
        checkpoints: [
          { label: "Checkpoint 1 - KM 3.7", value: "14:00.0" },
          { label: "Checkpoint 2 - KM 8.3", value: "20:00.0" },
          { label: "Finish", value: "6:00.0" },
        ],
        detailUrl: "https://results.scorenow.co.id/myresults.aspx?uid=19723-308-1-fixture-001",
        sourceUrl: context.sourceUrl,
        scrapedAt: context.scrapedAt,
      },
    ]);
  });

  it("parses a 5K row whose first desktop cell is a favorite control", () => {
    const row = tenKilometerRow
      .replace('<td><span class="rtv3-pos">1</span></td>', '<td><a class="fa fa-star"></a></td><td><span class="rtv3-pos">1</span></td>')
      .replace("T10001", "F50001")
      .replaceAll("19723-308-1-fixture-001", "19723-308-2-fixture-002")
      .replaceAll("EId=1", "EId=2")
      .replaceAll("00:40:00.000", "00:25:00.000")
      .replace("14:00.0", "15:00.0")
      .replace("20:00.0", "10:00.0")
      .replace(/<td class="rtv3-splitcell"><span class="rtv3-split-time">6:00\.0<\/span><\/td>/, "");

    const parsed = parseScoreNowPage(
      page(row, { summary: "5,987 results · page 1 of 120", checkpoints: ["Checkpoint 1 - KM 3.3", "Finish"] }),
      { ...context, eventId: 2, category: "5K" },
    );

    expect(parsed.results[0]).toMatchObject({
      eventId: 2,
      bibNumber: "F50001",
      officialTimeMilliseconds: 1_500_000,
      checkpoints: [
        { label: "Checkpoint 1 - KM 3.3", value: "15:00.0" },
        { label: "Finish", value: "10:00.0" },
      ],
    });
  });

  it("rejects a malformed official time instead of inventing a duration", () => {
    expect(() => parseScoreNowPage(page(tenKilometerRow.replaceAll("00:40:00.000", "not-a-time")), context)).toThrow(
      "Invalid official time",
    );
  });

  it("preserves blank checkpoint values for runners without intermediate splits", () => {
    const row = tenKilometerRow
      .replace('<td class="rtv3-splitcell"><span class="rtv3-split-time">14:00.0</span></td>', '<td class="rtv3-splitcell"></td>')
      .replace('<td class="rtv3-splitcell"><span class="rtv3-split-time">20:00.0</span></td>', '<td class="rtv3-splitcell"></td>');

    expect(parseScoreNowPage(page(row), context).results[0].checkpoints).toEqual([
      { label: "Checkpoint 1 - KM 3.7", value: "" },
      { label: "Checkpoint 2 - KM 8.3", value: "" },
      { label: "Finish", value: "6:00.0" },
    ]);
  });

  it("keeps unranked finishers instead of inventing positions or official times", () => {
    const row = tenKilometerRow
      .replace('<span class="rtv3-pos">1</span>', "")
      .replaceAll("00:40:00.000", "")
      .replaceAll(/<div class="rtv3-sub">[^<]+<\/div>/g, "");

    expect(parseScoreNowPage(page(row), context).results[0]).toMatchObject({
      position: null,
      officialTime: null,
      officialTimeMilliseconds: null,
      categoryRank: null,
      categoryTotal: null,
      genderRank: null,
      genderTotal: null,
    });
  });

  it("preserves the published result-status badge", () => {
    const row = tenKilometerRow.replace(
      "</a></td>",
      '</a><span class="mr-2 badge badge-pill badge-warning">DNF</span></td>',
    );
    expect(parseScoreNowPage(page(row), context).results[0].status).toBe("DNF");
  });

  it("rejects a row whose source UID identifies a different event", () => {
    expect(() => parseScoreNowPage(page(tenKilometerRow), { ...context, eventId: 2, category: "5K" })).toThrow(
      "Source UID does not match page context",
    );
  });
});
