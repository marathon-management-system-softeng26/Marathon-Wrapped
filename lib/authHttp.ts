import "server-only";
export const privateHeaders = { "Cache-Control": "private, no-store" };
export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get("origin") ===
    `${url.protocol}//${request.headers.get("host") ?? url.host}`
  );
}

/**
 * A request body read under a hard byte ceiling, so an authenticated endpoint cannot be made to
 * buffer an arbitrary amount before it has even looked at what was sent.
 */
export async function boundedJson(request: Request, limit = 1024): Promise<unknown> {
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
