import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as route from "@/app/api/internal/runner-photos/process/route";
import { processRunnerPhotoCleanup } from "@/lib/runnerPhotos/cleanup";

vi.mock("@/lib/runnerPhotos/cleanup", () => ({ processRunnerPhotoCleanup: vi.fn() }));

const request = (authorization?: string) => new Request("https://race.example/api/internal/runner-photos/process?batchSize=10000", {
  method: "POST", headers: authorization === undefined ? {} : { authorization },
});

function status(response: Response, expected: number) {
  expect(response.status).toBe(expected);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RUNNER_PHOTO_PROCESS_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Bearer short", "Bearer test-secrex", "bearer test-secret", "Bearer  test-secret"])(
  "requires an exact bearer header (%s)", async authorization => {
    status(await route.POST(request(authorization)), 401);
    expect(processRunnerPhotoCleanup).not.toHaveBeenCalled();
  });

it("returns 503 without starting a worker when the secret is unconfigured", async () => {
  vi.stubEnv("RUNNER_PHOTO_PROCESS_SECRET", "");
  status(await route.POST(request("Bearer test-secret")), 503);
  expect(processRunnerPhotoCleanup).not.toHaveBeenCalled();
});

it("runs one bounded batch on the server within the 60-second route budget", async () => {
  vi.mocked(processRunnerPhotoCleanup).mockResolvedValue({ swept: 2, processed: 1 });
  const result = await route.POST(request("Bearer test-secret"));
  status(result, 200);
  expect(await result.json()).toEqual({ swept: 2, processed: 1 });
  expect(route.maxDuration).toBe(60);
  expect(processRunnerPhotoCleanup).toHaveBeenCalledTimes(1);
  expect(processRunnerPhotoCleanup).toHaveBeenCalledWith();
});

it("returns a generic private response on backend failure", async () => {
  vi.mocked(processRunnerPhotoCleanup).mockRejectedValue(new Error("ready/private-path lease=private-token"));
  const result = await route.POST(request("Bearer test-secret"));
  status(result, 503);
  expect(await result.json()).toEqual({ error: "Photo service unavailable." });
});

it("keeps method-discovery and method-rejection responses private", () => {
  status(route.OPTIONS(), 204);
  for (const reject of [route.GET, route.HEAD, route.PUT, route.PATCH, route.DELETE]) status(reject(), 405);
  expect(processRunnerPhotoCleanup).not.toHaveBeenCalled();
});
