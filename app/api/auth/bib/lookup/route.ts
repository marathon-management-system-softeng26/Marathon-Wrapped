import {
  allowBibRequest,
  bibResponse,
  lookupBib,
  readAcceptedBibTicket,
  readBibJson,
  revokeBibTicket,
  setBibCookie,
  validBib,
  validBibEvent,
} from "@/lib/auth/bibRegistration";
import { sameOrigin } from "@/lib/authHttp";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open BIB lookup from this application." }, 403);
  const body = await readBibJson(request);
  if (!validBibEvent(body?.eventId) || !validBib(body?.bib)) {
    return bibResponse({ error: "Enter an event edition and a valid BIB." }, 400);
  }

  try {
    if (!(await allowBibRequest(request, "lookup"))) {
      return bibResponse({ error: "Too many BIB searches. Wait a few minutes and try again." }, 429);
    }
    const priorTicket = readAcceptedBibTicket(request);
    await revokeBibTicket(priorTicket);
    const result = await lookupBib(body.eventId, body.bib);
    const response = result
      ? bibResponse(result)
      : bibResponse({ error: "No result matched that event edition and BIB." }, 404);
    return priorTicket ? setBibCookie(response, request) : response;
  } catch {
    return bibResponse({ error: "BIB lookup is temporarily unavailable. Please retry." }, 503);
  }
}
