"use client";
import { useEffect, useRef, useState } from "react";
import { renderWrapped } from "@/lib/exportWrapped";
import { shareModel } from "@/lib/shareModel";
import type { RunnerWrappedPayload } from "@/lib/wrappedPayload";
export default function SharePreview({ payload }: { payload: RunnerWrappedPayload }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  const model = shareModel(payload);
  const timeLabel = model.timingLabel ? `${model.timingLabel} ${model.time}` : model.time;
  useEffect(() => {
    let cancelled = false;
    if (canvas.current)
      renderWrapped(canvas.current, payload).catch(() => {
        if (!cancelled)
          setError(
            "Image preview unavailable. You can retry saving your recap.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        className="share-canvas"
        width={1080}
        height={1350}
        role="img"
        aria-label={`${model.name}, ${model.distance}, ${timeLabel}, ${model.pace.includes("unavailable") ? model.pace : `average pace ${model.pace}`}.`}
      />
    </>
  );
}
