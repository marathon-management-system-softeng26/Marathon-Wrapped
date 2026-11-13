import { shareModel } from "./shareModel";
import type { StravaFirstWrappedPayload } from "./wrappedPayload";

export async function renderWrapped(
  canvas: HTMLCanvasElement,
  payload: StravaFirstWrappedPayload,
) {
  await renderShareModel(canvas, shareModel(payload));
}

async function renderShareModel(
  canvas: HTMLCanvasElement,
  model: ReturnType<typeof shareModel>,
) {
  await document.fonts.load('800 72px "Bricolage"');
  await document.fonts.ready;
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  ctx.fillStyle = "#a61729";
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "rgba(255, 246, 236, 0.1)";
  ctx.font = '800 220px "Bricolage", sans-serif';
  ctx.fillText(model.year, 490, 250, 540);
  ctx.fillStyle = "#fff6ec";
  ctx.beginPath();
  ctx.roundRect(145, 285, 790, 790, 34);
  ctx.fill();
  ctx.fillStyle = "#a61729";
  ctx.textAlign = "center";
  ctx.font = '800 34px "Bricolage", sans-serif';
  ctx.fillText("MARATHON WRAPPED", 540, 380, 650);
  const [distanceValue, distanceUnit = ""] = model.distance.split(" ");
  ctx.font = '800 170px "Bricolage", sans-serif';
  ctx.fillText(distanceValue, 540, 535, 650);
  ctx.font = '800 112px "Bricolage", sans-serif';
  ctx.fillText(distanceUnit, 540, 645, 650);
  ctx.font = '700 31px "Bricolage", sans-serif';
  ctx.fillText(`${model.time} moving time`, 540, 725, 650);
  ctx.fillText(model.pace === "Average pace unavailable" ? model.pace : `${model.pace} average pace`, 540, 775, 650);
  ctx.fillText(model.bib ? `${model.name} · BIB ${model.bib}` : model.name, 540, 1025, 650);
  ctx.font = '700 24px "Bricolage", sans-serif';
  if (model.splitNote) ctx.fillText(model.splitNote, 540, 885, 650);
  const splitRows = model.splits.slice(0, 6);
  const columns = splitRows.length > 3 ? 2 : 1;
  splitRows.forEach((split, index) => {
    const x = columns === 1 ? 540 : index % 2 === 0 ? 350 : 730;
    ctx.fillText(split, x, 845 + Math.floor(index / columns) * 34, 320);
  });
  if (model.splits.length > splitRows.length) {
    ctx.fillText(`Showing ${splitRows.length} of ${model.splits.length} splits`, 540, 970, 650);
  }
  ctx.fillStyle = "#fff6ec";
  ctx.font = '700 28px "Bricolage", sans-serif';
  ctx.fillText(model.event, 540, 1220, 936);
  ctx.textAlign = "start";
}
export async function exportWrapped(payload: StravaFirstWrappedPayload) {
  const model = shareModel(payload);
  const canvas = document.createElement("canvas");
  await renderShareModel(canvas, model);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Could not create image. Retry the download.")),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wrapped-${(model.bib ?? "runner").replace(/[^a-z0-9-]/gi, "-")}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
