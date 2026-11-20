"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const sections = [
  { href: "/", label: "Races" },
  { href: "/profile", label: "Profile" },
];

/**
 * The application shell. `showOrganizerLink` is passed by the screens that already hold the
 * session catalog, so the header never fetches access a second time to decide what to show.
 */
export default function AppHeader({
  showOrganizerLink = false,
}: {
  showOrganizerLink?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const links = showOrganizerLink
    ? [...sections, { href: "/organizer", label: "Manage event" }]
    : sections;
  const current = (href: string) =>
    href === "/" ? pathname === "/" : !!pathname?.startsWith(href);
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
      <nav className="app-nav" aria-label="Sections">
        <ul role="list">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} aria-current={current(href) ? "page" : undefined}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <button className="quiet" onClick={logout} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </header>
  );
}
