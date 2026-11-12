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
  ctx.fillStyle = "rgba(255, 246, 236, 0.1)";
  ctx.font = '800 220px "Bricolage", sans-serif';
  ctx.fillText("2027", 490, 250, 540);
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
  ctx.fillText(distanceValue, 540, 595, 650);
  ctx.font = '800 112px "Bricolage", sans-serif';
  ctx.fillText(distanceUnit, 540, 700, 650);
  ctx.font = '700 31px "Bricolage", sans-serif';
  ctx.fillText(`${model.time} · JAKARTA 2027`, 540, 820, 650);
  ctx.fillText(`${model.pace} average pace`, 540, 875, 650);
  ctx.fillText(`${model.name} · BIB ${model.bib ?? "unassigned"}`, 540, 975, 650);
  ctx.fillText(model.result, 540, 1025, 650);
  ctx.fillStyle = "#fff6ec";
  ctx.font = '700 28px "Bricolage", sans-serif';
  ctx.fillText("SOEKARNO RUN · SYNTHETIC DEMO RACE DATA", 540, 1220, 936);
  ctx.textAlign = "start";
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
