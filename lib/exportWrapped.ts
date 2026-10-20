import { shareModel } from "./shareModel";
import type { WrappedPayload } from "./wrappedPayload";
/** Local typography and vector canvas only: no health metrics or cross-origin photos. */
export async function renderWrapped(
  canvas: HTMLCanvasElement,
  payload: WrappedPayload,
) {
  await document.fonts.load('800 72px "Bricolage"');
  await document.fonts.ready;
  const model = shareModel(payload);
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  ctx.fillStyle = "#a61729";
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "#fff6ec";
  ctx.font = "700 32px sans-serif";
  ctx.fillText(model.event, 72, 100, 936);
  ctx.fillStyle = "#c8f02e";
  ctx.font = '800 100px "Bricolage", sans-serif';
  ctx.fillText("Your race,", 72, 245);
  ctx.fillText("wrapped.", 72, 350);
  ctx.fillStyle = "#fff6ec";
  ctx.beginPath();
  ctx.roundRect(72, 425, 936, 685, 32);
  ctx.fill();
  ctx.fillStyle = "#7a051d";
  ctx.font = '800 64px "Bricolage", sans-serif';
  ctx.fillText(model.name, 120, 520, 840);
  ctx.font = "500 28px sans-serif";
  ctx.fillText(
    `BIB ${model.bib ?? "unassigned"} · ${model.result}`,
    120,
    575,
    840,
  );
  ctx.font = '800 120px "Bricolage", sans-serif';
  ctx.fillText(model.distance, 120, 745, 840);
  ctx.font="500 28px sans-serif";
  ctx.fillText(model.distanceLabel,120,790,840);
  ctx.font = '800 68px "Bricolage", sans-serif';
  ctx.fillText(model.time, 120, 875);
  ctx.fillText(model.pace, 570, 875, 390);
  ctx.font = "500 28px sans-serif";
  ctx.fillText("Finish time", 120, 925);
  ctx.fillText("Average pace", 570, 925);
  ctx.fillText(model.rank || model.result, 120, 1040, 840);
  ctx.fillStyle = "#fff6ec";
  ctx.font = "700 29px sans-serif";
  ctx.fillText("MARATHON WRAPPED · DEMO RACE DATA", 72, 1220, 936);
}
export async function exportWrapped(payload: WrappedPayload) {
  const canvas = document.createElement("canvas");
  await renderWrapped(canvas, payload);
  const model = shareModel(payload);
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
