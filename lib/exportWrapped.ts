import { shareModel } from "./shareModel";
import type { RunnerWrappedPayload } from "./wrappedPayload";

export async function renderWrapped(
  canvas: HTMLCanvasElement,
  payload: RunnerWrappedPayload,
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
  const burgundy = "#510d23";
  const red = "#a61729";
  const cream = "#fff6ec";

  ctx.fillStyle = burgundy;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "rgba(255, 246, 236, 0.09)";
  ctx.font = '800 260px "Bricolage", sans-serif';
  ctx.fillText(model.year, 442, 258, 572);
  ctx.fillStyle = cream;
  ctx.font = '800 32px "Bricolage", sans-serif';
  ctx.fillText("MARATHON WRAPPED", 72, 117, 680);
  ctx.font = '800 72px "Bricolage", sans-serif';
  ctx.fillText(model.event, 72, 214, 936);

  ctx.beginPath();
  ctx.roundRect(72, 320, 936, 822, 36);
  ctx.fill();
  ctx.fillStyle = red;
  ctx.fillRect(122, 392, 72, 6);
  ctx.font = '700 28px "Bricolage", sans-serif';
  ctx.fillText("DISTANCE", 122, 452);
  ctx.fillStyle = burgundy;
  ctx.font = '800 166px "Bricolage", sans-serif';
  ctx.fillText(model.distance, 118, 617, 836);

  const time = model.timingLabel ? `${model.time} ${model.timingLabel}` : model.time;
  ctx.font = '800 38px "Bricolage", sans-serif';
  ctx.fillText(time, 122, 714, 390);
  ctx.fillText(model.pace.includes("unavailable") ? model.pace : `${model.pace} average pace`, 554, 714, 390);
  ctx.fillStyle = "#d9b6b0";
  ctx.fillRect(122, 759, 836, 2);

  ctx.fillStyle = burgundy;
  ctx.font = '700 27px "Bricolage", sans-serif';
  if (model.splitNote) ctx.fillText(model.splitNote, 122, 842, 836);
  const splitRows = model.splits.slice(0, 6);
  splitRows.forEach((split, index) => {
    const x = index % 2 === 0 ? 122 : 554;
    ctx.fillText(split, x, 831 + Math.floor(index / 2) * 47, 395);
  });
  if (model.splits.length > splitRows.length) {
    ctx.fillText(`Showing ${splitRows.length} of ${model.splits.length} splits`, 122, 994, 836);
  }
  ctx.fillStyle = red;
  ctx.font = '800 34px "Bricolage", sans-serif';
  ctx.fillText(model.bib ? `${model.name} · BIB ${model.bib}` : model.name, 122, 1076, 836);
  ctx.fillStyle = cream;
  ctx.font = '700 25px "Bricolage", sans-serif';
  ctx.fillText(model.attribution, 72, 1251, 936);
}
export async function exportWrapped(payload: RunnerWrappedPayload, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const model = shareModel(payload);
  const canvas = document.createElement("canvas");
  await renderShareModel(canvas, model);
  signal?.throwIfAborted();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Could not create image. Retry the download.")),
      "image/png",
    ),
  );
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wrapped-${(model.bib ?? "runner").replace(/[^a-z0-9-]/gi, "-")}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
