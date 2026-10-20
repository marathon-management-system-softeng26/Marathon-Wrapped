"use client";
import { useEffect, useState } from "react";
export type Catalog = {
  runners: { id: string; name: string; bib_number: string | null }[];
  events: { id: number; name: string }[];
};
export function useCatalog() {
  const [data, setData] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json();
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
  return { data, error, retry: () => setVersion((v) => v + 1) };
}
