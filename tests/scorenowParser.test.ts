import { describe, expect, it } from "vitest";
import { parseScoreNowPage } from "@/lib/scorenow/parser";

const context = {
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
  <tr data-href="myresults.aspx?uid=19723-308-1-536843">
    <td><span class="rtv3-pos">1</span></td>
    <td class="d-none d-sm-table-cell">14279</td>
    <td class="d-none d-sm-table-cell"><a class="grid-name"> RIKKI&nbsp; MARTHIN </a></td>
    <td class="d-sm-none"><a class="grid-name">RIKKI MARTHIN 14279</a></td>
    <td class="ltw-time">00:33:25.213</td><td class="d-sm-none">00:33:25.213</td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?CId=19723&amp;RId=308&amp;EId=1&amp;g=1&amp;c=1">Top 3 Umum</a><div class="rtv3-sub">1 of 3</div></td>
    <td><a class="grid-link rtv3-chip" href="results.aspx?CId=19723&amp;RId=308&amp;EId=1&amp;g=1">Male</a><div class="rtv3-sub">1 of 2,100</div></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">11:58.8</span></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">16:19.1</span></td>
    <td class="rtv3-splitcell"><span class="rtv3-split-time">0:35.9</span></td>
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
        sourceUid: "19723-308-1-536843",
        category: "10K",
        position: 1,
        bibNumber: "14279",
        name: "RIKKI MARTHIN",
        officialTime: "00:33:25.213",
        officialTimeMilliseconds: 2_005_213,
        categoryName: "Top 3 Umum",
        categoryRank: 1,
        categoryTotal: 3,
        gender: "Male",
        genderRank: 1,
        genderTotal: 2100,
        checkpoints: [
          { label: "Checkpoint 1 - KM 3.7", value: "11:58.8" },
          { label: "Checkpoint 2 - KM 8.3", value: "16:19.1" },
          { label: "Finish", value: "0:35.9" },
        ],
        detailUrl: "https://results.scorenow.co.id/myresults.aspx?uid=19723-308-1-536843",
        sourceUrl: context.sourceUrl,
        scrapedAt: context.scrapedAt,
      },
    ]);
  });

  it("parses a 5K row whose first desktop cell is a favorite control", () => {
    const row = tenKilometerRow
      .replace('<td><span class="rtv3-pos">1</span></td>', '<td><a class="fa fa-star"></a></td><td><span class="rtv3-pos">1</span></td>')
      .replace("14279", "51531")
      .replaceAll("19723-308-1-536843", "19723-308-2-533765")
      .replaceAll("EId=1", "EId=2")
      .replace("00:33:25.213", "00:14:46.840")
      .replace("11:58.8", "9:53.7")
      .replace("16:19.1", "0:32.3")
      .replace(/<td class="rtv3-splitcell"><span class="rtv3-split-time">0:35\.9<\/span><\/td>/, "");

    const parsed = parseScoreNowPage(
      page(row, { summary: "5,987 results · page 1 of 120", checkpoints: ["Checkpoint 1 - KM 3.3", "Finish"] }),
      { ...context, eventId: 2, category: "5K" },
    );

    expect(parsed.results[0]).toMatchObject({
      eventId: 2,
      bibNumber: "51531",
      officialTimeMilliseconds: 886_840,
      checkpoints: [
        { label: "Checkpoint 1 - KM 3.3", value: "9:53.7" },
        { label: "Finish", value: "0:32.3" },
      ],
    });
  });

  it("rejects a malformed official time instead of inventing a duration", () => {
    expect(() => parseScoreNowPage(page(tenKilometerRow.replaceAll("00:33:25.213", "not-a-time")), context)).toThrow(
      "Invalid official time",
    );
  });

  it("preserves blank checkpoint values for runners without intermediate splits", () => {
    const row = tenKilometerRow
      .replace('<td class="rtv3-splitcell"><span class="rtv3-split-time">11:58.8</span></td>', '<td class="rtv3-splitcell"></td>')
      .replace('<td class="rtv3-splitcell"><span class="rtv3-split-time">16:19.1</span></td>', '<td class="rtv3-splitcell"></td>');

    expect(parseScoreNowPage(page(row), context).results[0].checkpoints).toEqual([
      { label: "Checkpoint 1 - KM 3.7", value: "" },
      { label: "Checkpoint 2 - KM 8.3", value: "" },
      { label: "Finish", value: "0:35.9" },
    ]);
  });

  it("keeps unranked finishers instead of inventing positions or official times", () => {
    const row = tenKilometerRow
      .replace('<span class="rtv3-pos">1</span>', "")
      .replaceAll("00:33:25.213", "")
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
});
