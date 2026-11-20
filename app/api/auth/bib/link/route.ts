import {
  allowBibRequest,
  bibResponse,
  linkAcceptedBib,
  readAcceptedBibTicket,
  readBibJson,
  setBibCookie,
} from "@/lib/auth/bibRegistration";
import { AuthenticationError, requireConfirmedUser, UnconfirmedEmailError } from "@/lib/auth/session";
import { sameOrigin } from "@/lib/authHttp";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return bibResponse({ error: "Open BIB linking from this application." }, 403);
  if (request.body && !(await readBibJson(request))) {
    return bibResponse({ error: "Enter a valid BIB request." }, 400);
  }
  const ticket = readAcceptedBibTicket(request);
  if (!ticket) return bibResponse({ error: "Look up and confirm your BIB first." }, 409);

  try {
    const user = await requireConfirmedUser();
    if (!(await allowBibRequest(request, "submission"))) {
      return bibResponse({ error: "Too many BIB attempts. Wait a few minutes and try again." }, 429);
    }
    if (!(await linkAcceptedBib(user.id, ticket))) {
      return bibResponse({ error: "This BIB could not be linked to your account." }, 409);
    }
    return setBibCookie(bibResponse({ status: "linked" }), request);
  } catch (error) {
    if (error instanceof AuthenticationError) return bibResponse({ error: "Sign in to link your BIB." }, 401);
    if (error instanceof UnconfirmedEmailError) return bibResponse({ error: error.message }, 403);
    return bibResponse({ error: "BIB linking is temporarily unavailable. Please retry." }, 503);
  }
}
