import type { ScoreNowPage, ScoreNowPageContext, ScoreNowResult } from "./types.ts";

const RESULT_ORIGIN = "https://results.scorenow.co.id/";

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === "x";
    const parsed = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
  });
}

function text(html: string) {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(fragment: string, name: string) {
  const match = fragment.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : null;
}

function integer(value: string, label: string) {
  const parsed = Number.parseInt(value.replaceAll(",", ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function durationMilliseconds(value: string) {
  const match = value.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) throw new Error(`Invalid official time: ${value}`);
  const [, hours, minutes, seconds, fraction = ""] = match;
  const minute = integer(minutes, "official time minute");
  const second = integer(seconds, "official time second");
  if (minute > 59 || second > 59) throw new Error(`Invalid official time: ${value}`);
  return ((integer(hours, "official time hour") * 60 + minute) * 60 + second) * 1000 + Number(fraction.padEnd(3, "0"));
}

function cells(rowHtml: string) {
  return Array.from(rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi), (match) => ({ attributes: match[1], html: match[2] }));
}

function links(cellHtml: string) {
  return Array.from(cellHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi), (match) => ({
    href: attribute(match[1], "href") ?? "",
    className: attribute(match[1], "class") ?? "",
    label: text(match[2]),
  }));
}

function rankedCell(rowCells: ReturnType<typeof cells>, kind: "category" | "gender") {
  const found = rowCells
    .map((cell) => ({ cell, link: links(cell.html).find((link) => link.className.split(/\s+/).includes("rtv3-chip")) }))
    .find(({ link }) => {
      if (!link) return false;
      const hasGender = /(?:[?&]|&amp;)g=\d+/i.test(link.href);
      const hasCategory = /(?:[?&]|&amp;)c=\d+/i.test(link.href);
      return kind === "category" ? hasGender && hasCategory : hasGender && !hasCategory;
    });
  if (!found?.link) throw new Error(`Missing ${kind} cell`);
  const rankText = text(found.cell.html.match(/<div\b[^>]*class=["'][^"']*rtv3-sub[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  if (!rankText) return { label: found.link.label, rank: null, total: null };
  const rank = rankText.match(/^([\d,]+)\s+of\s+([\d,]+)$/i);
  if (!rank) throw new Error(`Invalid ${kind} rank: ${rankText}`);
  return { label: found.link.label, rank: integer(rank[1], `${kind} rank`), total: integer(rank[2], `${kind} total`) };
}

function parseRow(rowAttributes: string, rowHtml: string, checkpointLabels: string[], context: ScoreNowPageContext): ScoreNowResult {
  const rowCells = cells(rowHtml);
  const detailPath = attribute(rowAttributes, "data-href");
  if (!detailPath) throw new Error("Missing result detail URL");
  const detailUrl = new URL(detailPath, RESULT_ORIGIN).toString();
  const sourceUid = new URL(detailUrl).searchParams.get("uid");
  if (!sourceUid) throw new Error(`Missing source UID: ${detailUrl}`);
  const expectedUidPrefix = `${context.competitionId}-${context.raceId}-${context.eventId}-`;
  if (!sourceUid.startsWith(expectedUidPrefix)) {
    throw new Error(`Source UID does not match page context: ${sourceUid}`);
  }

  const nameIndex = rowCells.findIndex(
    (cell) => /grid-name/i.test(cell.html) && /d-none/i.test(cell.attributes) && /d-sm-table-cell/i.test(cell.attributes),
  );
  const resolvedNameIndex = nameIndex >= 0 ? nameIndex : rowCells.findIndex((cell) => /grid-name/i.test(cell.html));
  const positionCell = rowCells.find((cell) => /rtv3-pos/i.test(cell.html)) ?? rowCells[resolvedNameIndex - 2];
  const timeCell = rowCells.find((cell) => /(?:^|\s)ltw-time(?:\s|$)/i.test(attribute(cell.attributes, "class") ?? ""));
  if (!positionCell || resolvedNameIndex < 1 || !timeCell) throw new Error(`Incomplete result row: ${sourceUid}`);

  const nameLink = links(rowCells[resolvedNameIndex].html).find((link) => link.className.split(/\s+/).includes("grid-name"));
  const statusMatch = text(
    rowCells[resolvedNameIndex].html.match(
      /<span\b[^>]*class=["'][^"']*(?:^|\s)badge(?:\s|$)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1] ?? "",
  ).toUpperCase();
  const status = statusMatch ? (statusMatch as ScoreNowResult["status"]) : null;
  if (status !== null && !["CUT", "DNF", "DNS"].includes(status)) throw new Error(`Invalid result status: ${status}`);
  const category = rankedCell(rowCells, "category");
  const gender = rankedCell(rowCells, "gender");
  const checkpointValues = rowCells
    .filter((cell) => /(?:^|\s)rtv3-splitcell(?:\s|$)/i.test(attribute(cell.attributes, "class") ?? ""))
    .map((cell) => text(cell.html.match(/<span\b[^>]*class=["'][^"']*rtv3-split-time[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""));
  if (checkpointValues.length !== checkpointLabels.length) {
    throw new Error(`Checkpoint count mismatch for ${sourceUid}: ${checkpointValues.length}/${checkpointLabels.length}`);
  }
  const officialTime = text(timeCell.html);
  const position = text(positionCell.html);

  return {
    competitionId: context.competitionId,
    raceId: context.raceId,
    eventId: context.eventId,
    sourceUid,
    category: context.category,
    position: position ? integer(position, "position") : null,
    bibNumber: text(rowCells[resolvedNameIndex - 1].html),
    name: nameLink?.label ?? "",
    status,
    officialTime: officialTime || null,
    officialTimeMilliseconds: officialTime ? durationMilliseconds(officialTime) : null,
    categoryName: category.label,
    categoryRank: category.rank,
    categoryTotal: category.total,
    gender: gender.label,
    genderRank: gender.rank,
    genderTotal: gender.total,
    checkpoints: checkpointLabels.map((label, index) => ({ label, value: checkpointValues[index] })),
    detailUrl,
    sourceUrl: context.sourceUrl,
    scrapedAt: context.scrapedAt,
  };
}

export function parseScoreNowPage(html: string, context: ScoreNowPageContext): ScoreNowPage {
  const viewBar = /<[^>]+id=["']ctl00_Content_Main_divV3ViewBar["'][^>]*>/i.exec(html);
  const tableStart = html.search(/<table\b[^>]*id=["']ctl00_Content_Main_tblResults["']/i);
  const summaryHtml = viewBar && tableStart > viewBar.index ? html.slice(viewBar.index + viewBar[0].length, tableStart) : "";
  const summary = text(summaryHtml);
  const counts = summary.match(/([\d,]+)\s+results\s*[·•-]\s*page\s+(\d+)\s+of\s+(\d+)/i);
  if (!counts) throw new Error(`Invalid result summary: ${summary}`);

  const table = html.match(/<table\b[^>]*id=["']ctl00_Content_Main_tblResults["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error("Missing results table");
  const rows = Array.from(table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi));
  if (rows.length === 0) throw new Error("Missing results header");
  const checkpointLabels = cells(rows[0][2])
    .map((cell) => text(cell.html))
    .filter((label) => /^(?:checkpoint\b|finish$)/i.test(label));
  if (checkpointLabels.length === 0) throw new Error("Missing checkpoint headers");

  return {
    declaredTotal: integer(counts[1], "declared total"),
    pageNumber: integer(counts[2], "page number"),
    totalPages: integer(counts[3], "total pages"),
    checkpointLabels,
    results: rows.slice(1).filter((row) => /\bdata-href\s*=/i.test(row[1])).map((row) => parseRow(row[1], row[2], checkpointLabels, context)),
  };
}
