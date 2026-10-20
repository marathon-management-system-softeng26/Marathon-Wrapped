"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
export default function AppHeader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Retry.");
      setBusy(false);
    }
  }
  return (
    <header className="app-header">
      <Link href="/" className="wordmark">
        Marathon
        <br />
        <b>Wrapped.</b>
      </Link>
      <div>
        <button className="quiet" onClick={logout} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </header>
  );
}
