import "server-only";
import { AuthenticationError, requireUser } from "@/lib/auth/session";
import { boundedJson, privateHeaders, sameOrigin } from "@/lib/authHttp";
import { RunnerPhotoError } from "./types";
import { parsePhotoId } from "./validation";

type RunnerParams = { runnerId: string };
type PhotoParams = RunnerParams & { photoId: string };
export type RunnerContext = { params: Promise<RunnerParams> };
export type PhotoContext = { params: Promise<PhotoParams> };

export const photoJson = (data: unknown, status = 200) => Response.json(data, { status, headers: privateHeaders });
const errorStatus = { invalid: 400, not_found: 404, quota: 409, in_progress: 409, unavailable: 503 };

export async function photoRoute<T extends RunnerParams>(
  context: { params: Promise<T> },
  action: (userId: string, params: T) => Promise<Response>,
) {
  try {
    const user = await requireUser();
    const params = await context.params;
    const runnerId = parsePhotoId(params.runnerId).toLowerCase();
    const ids = "photoId" in params ? { photoId: parsePhotoId(params.photoId).toLowerCase() } : {};
    return await action(user.id, { ...params, runnerId, ...ids });
  } catch (error) {
    if (error instanceof AuthenticationError) return photoJson({ error: "Sign in to manage race photos." }, 401);
    if (error instanceof OriginError) return photoJson({ error: "Invalid request origin." }, 403);
    const safe = new RunnerPhotoError(error instanceof RunnerPhotoError ? error.code : "unavailable");
    return photoJson({ error: safe.message }, errorStatus[safe.code]);
  }
}

class OriginError extends Error {}

export async function writeBody(request: Request): Promise<Record<string, unknown>> {
  if (!sameOrigin(request)) throw new OriginError();
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    throw new RunnerPhotoError("invalid");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RunnerPhotoError("invalid");
  return body as Record<string, unknown>;
}

export async function emptyWriteBody(request: Request) {
  if (Object.keys(await writeBody(request)).length) throw new RunnerPhotoError("invalid");
}
