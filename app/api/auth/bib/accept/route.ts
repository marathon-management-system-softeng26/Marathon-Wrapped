import {
  acceptBib,
  allowBibRequest,
  bibResponse,
  isBibTicket,
  readAcceptedBibTicket,
  readBibJson,
  revokeBibTicket,
  setBibCookie,
} from "@/lib/auth/bibRegistration";
import { sameOrigin } from "@/lib/authHttp";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open BIB confirmation from this application." }, 403);
  const body = await readBibJson(request);
  if (!isBibTicket(body?.ticket)) return bibResponse({ error: "Look up your BIB again." }, 400);

  try {
    if (!(await allowBibRequest(request, "lookup"))) {
      return bibResponse({ error: "Too many BIB attempts. Wait a few minutes and try again." }, 429);
    }
    const result = await acceptBib(body.ticket);
    if (!result) return bibResponse({ error: "Look up your BIB again." }, 409);
    await revokeBibTicket(readAcceptedBibTicket(request));
    return setBibCookie(bibResponse({ accepted: true }), request, result.acceptedTicket, result.expiresAt);
  } catch {
    return bibResponse({ error: "BIB confirmation is temporarily unavailable. Please retry." }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open BIB confirmation from this application." }, 403);
  const body = await readBibJson(request);
  if (!body || (body.ticket !== undefined && !isBibTicket(body.ticket))) {
    return bibResponse({ error: "Look up your BIB again." }, 400);
  }

  try {
    await revokeBibTicket(body.ticket ?? null);
    await revokeBibTicket(readAcceptedBibTicket(request));
    return setBibCookie(bibResponse({ accepted: false }), request);
  } catch {
    return bibResponse({ error: "BIB confirmation is temporarily unavailable. Please retry." }, 503);
  }
}
