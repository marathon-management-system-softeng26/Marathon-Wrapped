import "server-only";
export const privateHeaders = { "Cache-Control": "private, no-store" };
export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  return (
    request.headers.get("origin") ===
    `${url.protocol}//${request.headers.get("host") ?? url.host}`
  );
}
