import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { boundedJson, privateHeaders } from "@/lib/authHttp";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const ACCEPTANCE_COOKIE = "mw_bib_acceptance";
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BIB_PATTERN = /^[A-Za-z0-9-]{1,40}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

type Match = { bib: string; name: string; distance: "5K" | "10K" };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const issueTicket = () => randomBytes(32).toString("base64url");

export function validBib(value: unknown): value is string {
  return typeof value === "string" && BIB_PATTERN.test(value.trim());
}

export function isBibTicket(value: unknown): value is string {
  return typeof value === "string" && TICKET_PATTERN.test(value);
}

export function validBibEvent(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function serviceUnavailable(): never {
  throw new Error("BIB registration is temporarily unavailable.");
}

async function rpc(name: string, args: Record<string, string | number>): Promise<unknown> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);
  if (error) serviceUnavailable();
  return data;
}

export async function lookupBib(eventId: number, bib: string): Promise<{ ticket: string; match: Match } | null> {
  if (!validBibEvent(eventId) || !validBib(bib)) return null;
  const ticket = issueTicket();
  const data = await rpc("lookup_published_bib", {
    p_event_id: eventId,
    p_bib: bib.trim(),
    p_ticket_hash: hash(ticket),
  });
  if (data === null || (Array.isArray(data) && data.length === 0)) return null;
  if (!Array.isArray(data) || data.length !== 1 || !data[0]) serviceUnavailable();
  const { bib: foundBib, name, distance } = data[0];
  if (typeof foundBib !== "string" || typeof name !== "string" || (distance !== "5K" && distance !== "10K")) {
    serviceUnavailable();
  }
  return { ticket, match: { bib: foundBib, name, distance } };
}

export async function acceptBib(ticket: string): Promise<{ acceptedTicket: string; expiresAt: Date } | null> {
  if (!isBibTicket(ticket)) return null;
  const acceptedTicket = issueTicket();
  const data = await rpc("accept_bib_ticket", {
    p_ticket_hash: hash(ticket),
    p_accepted_ticket_hash: hash(acceptedTicket),
  });
  if (data === null) return null;
  if (typeof data !== "string") serviceUnavailable();
  const expiresAt = new Date(data);
  if (!Number.isFinite(expiresAt.getTime())) serviceUnavailable();
  if (expiresAt.getTime() <= Date.now()) return null;
  return { acceptedTicket, expiresAt };
}

export async function revokeBibTicket(ticket: string | null): Promise<void> {
  if (isBibTicket(ticket)) await rpc("revoke_bib_ticket", { p_ticket_hash: hash(ticket) });
}

export async function beginBibSignup(acceptedTicket: string, email: string): Promise<"reserved" | "unavailable"> {
  if (!isBibTicket(acceptedTicket)) return "unavailable";
  const data = await rpc("begin_bib_signup", {
    p_ticket_hash: hash(acceptedTicket),
    p_email: email.trim().toLowerCase(),
  });
  if (data === "reserved" || data === "unavailable") return data;
  return serviceUnavailable();
}

export async function finalizeBibSignup(userId: string): Promise<string[]> {
  if (!UUID_PATTERN.test(userId)) return [];
  const data = await rpc("finalize_bib_signup", { p_user_id: userId });
  if (!Array.isArray(data) || data.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    serviceUnavailable();
  }
  return data;
}

export async function linkAcceptedBib(userId: string, acceptedTicket: string): Promise<boolean> {
  if (!UUID_PATTERN.test(userId) || !isBibTicket(acceptedTicket)) return false;
  const data = await rpc("link_accepted_bib", {
    p_user_id: userId,
    p_ticket_hash: hash(acceptedTicket),
  });
  if (data === null) return false;
  if (typeof data !== "string" || !UUID_PATTERN.test(data)) serviceUnavailable();
  return true;
}

export async function allowBibRequest(request: Request, bucket: "lookup" | "submission"): Promise<boolean> {
  // Only Vercel's trusted ingress can identify a client. Elsewhere all traffic shares a bucket.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  const client = ip && isIP(ip) ? ip : "shared";
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const digest = key ? createHmac("sha256", key).update(client).digest("hex") : hash(client);
  const data = await rpc("consume_bib_rate_limit", { p_bucket: bucket, p_key: digest });
  if (typeof data !== "boolean") serviceUnavailable();
  return data;
}

export async function readBibJson(request: Request, limit = 1024): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return null;
  }
  try {
    const body = await boundedJson(request, limit);
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readAcceptedBibTicket(request: Request): string | null {
  const prefix = ACCEPTANCE_COOKIE + "=";
  const parts = request.headers.get("cookie")?.split(";") ?? [];
  const matches = parts.map((part) => part.trim()).filter((part) => part.startsWith(prefix));
  const value = matches.length === 1 ? matches[0].slice(prefix.length) : null;
  return isBibTicket(value) ? value : null;
}

export function bibResponse(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

export function setBibCookie(response: NextResponse, request: Request, ticket?: string, expires?: Date) {
  response.cookies.set(ACCEPTANCE_COOKIE, ticket ?? "", {
    path: "/api/auth",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
    ...(ticket ? { expires } : { maxAge: 0 }),
  });
  return response;
}
