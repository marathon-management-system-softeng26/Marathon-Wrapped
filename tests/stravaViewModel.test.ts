import { describe, expect, it, vi } from "vitest";
import { callbackFeedback, routeToStrava, stravaViewModel, runStravaAction } from "@/lib/strava/viewModel";
import type { WrappedPayloadStrava } from "@/lib/wrappedPayload";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StravaCard from "@/app/components/StravaCard";

const runner = "11111111-1111-1111-1111-111111111111";
const candidate = { activityId: "10", startTimeLocal: "2027-08-17T07:15:00+07:00", distanceMeters: 5000, sportType: "Run", gpsAvailable: false, matchReason: "missing_start_location" };
const state = (value: WrappedPayloadStrava["state"]): WrappedPayloadStrava => ({ state: value, metrics: null, candidates: [candidate] });

describe("Strava controls and readable state", () => {
  it("renders a real POST connect form and preserves baseline guidance", () => {
    const html = renderToStaticMarkup(createElement(StravaCard, { input: state("demo"), runnerId: runner, onRefresh: () => {} }));
    expect(html).toContain('action="/api/strava/connect"'); expect(html).toContain('method="post"');
    expect(html).toContain(`name="runnerId" value="${runner}"`);
    expect(html).toContain("Seeded sample metrics"); expect(html).toContain("chip result, splits and photos");
    expect(html).not.toContain('href="/api/strava/connect"');
  });
  it("renders separate explicit confirmation and disconnect buttons with safe summaries", () => {
    const html = renderToStaticMarkup(createElement(StravaCard, { input: state("needs_confirmation"), runnerId: runner, onRefresh: () => {} }));
    expect(html).toContain("17 Aug 2027, 07:15 WIB · 5.00 km");
    expect(html).toContain("Use this activity"); expect(html).toContain("Disconnect Strava");
    expect(html).not.toMatch(/polyline|startLatLng|access_token/);
  });
  it.each([
    ["disconnected", "Connect Strava", ["connect"]],
    ["demo", "Sample activity metrics", ["connect"]],
    ["authorizing", "Authorize Strava", ["cancel"]],
    ["attachable", "Use Strava for this race", ["attach", "disconnect"]],
    ["importing", "Importing your activity", ["check", "detach", "disconnect"]],
    ["needs_confirmation", "Choose your race activity", ["check", "detach", "disconnect"]],
    ["no_match", "No race activity found", ["connect", "check", "detach", "disconnect"]],
    ["building", "Building your Wrapped", ["check", "detach", "disconnect"]],
    ["connected", "Your Strava activity", ["check", "detach", "disconnect"]],
    ["unavailable", "Activity details are unavailable", ["connect", "check", "detach", "disconnect"]],
    ["disconnecting", "Disconnecting Strava", ["check", "disconnect"]],
    ["reauthorize_required", "Authorize Strava again", ["connect", "disconnect"]],
  ] as const)("offers explicit actions for %s", (value, title, actions) => {
    const model = stravaViewModel(state(value), runner);
    expect(model.title).toBe(title);
    expect(model.actions.map((action) => action.id)).toEqual(actions);
    expect(model.actions.every((action) => !action.disabled)).toBe(true);
    expect(model.baselineCopy).toContain("chip result, splits and photos");
  });
  it("connects with an explicit same-origin POST and disables actions while pending", () => {
    const model = stravaViewModel(state("demo"), runner, true);
    expect(model.actions[0]).toMatchObject({ id: "connect", method: "POST", path: "/api/strava/connect", disabled: true });
    expect(stravaViewModel({ ...state("demo"), controlsAvailable: false }, runner).actions).toEqual([]);
  });
  it.each(["no_match", "unavailable"] as const)("offers a durable import retry for %s", (value) => {
    const retry = stravaViewModel(state(value), runner).actions[0];
    expect(retry).toMatchObject({ id: "connect", label: "Retry import", method: "POST", path: "/api/strava/connect" });
  });
  it("separates per-race attachment from account-wide connection", () => {
    const [attach, disconnect] = stravaViewModel(state("attachable"), runner).actions;
    expect(attach).toMatchObject({ id: "attach", label: "Use Strava for this race", method: "POST", path: `/api/runners/${runner}/strava/attach` });
    expect(disconnect).toMatchObject({ id: "disconnect", label: "Disconnect Strava", method: "POST", path: "/api/strava/disconnect" });
  });
  it("offers per-race detach separately from account disconnect once attached", () => {
    const model = stravaViewModel(state("connected"), runner);
    const detach = model.actions.find((action) => action.id === "detach");
    expect(detach).toMatchObject({ label: "Remove Strava from this race", method: "POST", path: `/api/runners/${runner}/strava/detach` });
    expect(model.actions.find((action) => action.id === "disconnect")?.path).toBe("/api/strava/disconnect");
  });
  it("asks for private-activity consent before any authorization", () => {
    for (const value of ["disconnected", "attachable"] as const) {
      expect(stravaViewModel(state(value), runner).description).toContain("private");
    }
    expect(stravaViewModel(state("attachable"), runner).description).toContain("this race");
  });
  it("reports build progress without offering a premature showcase", () => {
    const model = stravaViewModel(state("building"), runner);
    expect(model.description).toContain("Building");
    expect(model.metrics).toEqual([]);
    expect(model.candidates).toEqual([]);
  });
  it.each(["attachable", "building"] as const)("withholds runner controls for organizer-only access to %s", (value) => {
    expect(stravaViewModel({ ...state(value), controlsAvailable: false }, runner).actions).toEqual([]);
  });
  it("maps unattached and projecting route statuses to their own states", () => {
    expect(routeToStrava({ status: "attachable", activityId: null, candidates: [candidate], metrics: {} }))
      .toMatchObject({ state: "attachable", activityId: null, candidates: [], metrics: null });
    expect(routeToStrava({ status: "building", activityId: "10", candidates: [candidate], metrics: { avg_heartrate: 150 } }))
      .toMatchObject({ state: "building", activityId: null, metrics: null });
  });
  it("attaches and detaches one race over same-origin POSTs", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "importing", activityId: null, candidates: [], metrics: {} }));
    expect((await runStravaAction(fetcher, runner, "attach")).state).toBe("importing");
    expect(fetcher).toHaveBeenLastCalledWith(`/api/runners/${runner}/strava/attach`,
      expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }));
    fetcher.mockResolvedValue(Response.json({ status: "attachable", activityId: null, candidates: [], metrics: {} }));
    expect((await runStravaAction(fetcher, runner, "detach")).state).toBe("attachable");
    expect(fetcher).toHaveBeenLastCalledWith(`/api/runners/${runner}/strava/detach`,
      expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });
  it("names confirmation date and distance without route details", () => {
    const model = stravaViewModel(state("needs_confirmation"), runner);
    expect(model.candidates).toEqual([{ activityId: "10", label: "17 Aug 2027, 07:15 WIB · 5.00 km", note: "GPS is unavailable. Confirm this is your race activity." }]);
    expect(stravaViewModel(state("connected"), runner).candidates).toEqual([]);
  });
  it("preserves partial live measurements and provider cadence units", () => {
    const input = routeToStrava({ status: "matched", activityId: "10", candidates: [candidate], metrics: { avg_heartrate: 145.5, elevation_gain_m: 0, avg_cadence: 80.5 } });
    const model = stravaViewModel(input, runner);
    expect(model.metrics).toEqual([
      { label: "Average heart rate (bpm)", value: 145.5 },
      { label: "Elevation gain (m)", value: 0 },
      { label: "Average cadence (Strava value)", value: 80.5 },
    ]);
    expect(JSON.stringify(model)).not.toContain("spm");
  });
  it("suppresses stale measurements for nonselected API states", () => {
    const result = routeToStrava({ status: "needs_confirmation", activityId: null, candidates: [candidate], metrics: { avg_heartrate: 155 } });
    expect(result.metrics).toBeNull();
    expect(routeToStrava({ status: "reauthorize_to_disconnect", activityId: null, candidates: [], metrics: {} })).toMatchObject({ state: "reauthorize_required", reauthorizeToDisconnect: true });
  });
  it("shows only allowlisted callback feedback and consumes it from the URL", () => {
    expect(callbackFeedback("https://race.test/wrapped/runner?strava=connected&keep=yes#context")).toEqual({ notice: "Strava authorized. Checking your race activity.", path: "/wrapped/runner?keep=yes#context" });
    expect(callbackFeedback("https://race.test/wrapped/runner?strava=private-token")).toEqual({ notice: "Strava could not connect. Try connecting again.", path: "/wrapped/runner" });
    expect(callbackFeedback("https://race.test/wrapped/runner")).toBeNull();
    expect(callbackFeedback("https://race.test/wrapped/runner?strava=import_failed")).toEqual({
      notice: "Strava connected, but activity import could not start. Retry import.",
      path: "/wrapped/runner",
    });
  });
  it.each(["__proto__", "toString", "constructor"])("treats prototype callback key %s as unrecognized", (code) => {
    expect(callbackFeedback(`https://race.test/wrapped/runner?strava=${code}`)).toEqual({
      notice: "Strava could not connect. Try connecting again.",
      path: "/wrapped/runner",
    });
  });
  it("confirms only an explicitly chosen activity and handles cleanup reauthorization", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "reauthorize_to_disconnect" }), { status: 409 }));
    const result = await runStravaAction(fetcher, runner, "disconnect");
    expect(fetcher).toHaveBeenCalledWith("/api/strava/disconnect", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }));
    expect(result.state).toBe("reauthorize_required");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ status: "matched", activityId: "10", candidates: [], metrics: {} })));
    await runStravaAction(fetcher, runner, "confirm", "10");
    expect(fetcher).toHaveBeenLastCalledWith(`/api/runners/${runner}/strava`, expect.objectContaining({ method: "PUT", body: '{"activityId":"10"}' }));
  });
  it("uses safe actionable errors without provider text", async () => {
    await expect(runStravaAction(async () => new Response('{"error":"private-token"}', { status: 503 }), runner, "check")).rejects.toThrow("Strava could not update. Check status to try again.");
  });
});
