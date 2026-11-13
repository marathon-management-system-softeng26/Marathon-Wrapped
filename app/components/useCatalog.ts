"use client";
import { useCallback, useEffect, useState } from "react";
import type { RunnerCatalog } from "@/lib/runnerCatalog";

export function useCatalog() {
  const [data, setData] = useState<RunnerCatalog | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const retry = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error);
        setData(body);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause.message || "Could not load your races.");
      });
    return () => controller.abort();
  }, [version]);
  return { data, error, retry };
}
