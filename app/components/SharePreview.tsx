"use client";
import { useEffect, useRef, useState } from "react";
import { renderWrapped } from "@/lib/exportWrapped";
import { shareModel } from "@/lib/shareModel";
import type { WrappedPayload } from "@/lib/wrappedPayload";
export default function SharePreview({ payload }: { payload: WrappedPayload }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  const model = shareModel(payload);
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
        aria-label={`${model.name}, ${model.distance}, ${model.result}, finish time ${model.time}, average pace ${model.pace}. Demo race data.`}
      />
    </>
  );
}
