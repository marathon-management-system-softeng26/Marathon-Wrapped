import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
import {
  ProfileError,
  getProfileName,
  linkRegistrationByBib,
  saveProfileName,
  unavailableBibMessage,
} from "@/controllers/profileController";

const profileRow = (data: unknown, error: unknown = null) => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
});

describe("runner profile name", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports no name rather than inventing one for a new account", async () => {
    mocks.from.mockReturnValue(profileRow(null));
    expect(await getProfileName("user")).toBeNull();
  });

  it("returns the stored name", async () => {
    mocks.from.mockReturnValue(profileRow({ display_name: "Dewi Kartika" }));
    expect(await getProfileName("user")).toBe("Dewi Kartika");
  });

  it("does not leak a storage failure as a missing name", async () => {
    mocks.from.mockReturnValue(profileRow(null, { message: "boom" }));
    await expect(getProfileName("user")).rejects.toThrow("Your profile is temporarily unavailable.");
  });

  it.each([["", "empty"], ["   ", "blank"], ["n".repeat(121), "overlong"]])(
    "refuses a %s name before any query",
    async (value) => {
      await expect(saveProfileName("user", value)).rejects.toBeInstanceOf(ProfileError);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("refuses a non-string name before any query", async () => {
    await expect(saveProfileName("user", { display_name: "x" })).rejects.toBeInstanceOf(ProfileError);
    await expect(saveProfileName("user", undefined)).rejects.toBeInstanceOf(ProfileError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("trims the name and sends the verified account id, never a form field", async () => {
    mocks.rpc.mockResolvedValue({ data: "Dewi Kartika", error: null });
    expect(await saveProfileName("user", "  Dewi Kartika  ")).toBe("Dewi Kartika");
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_runner_profile", {
      p_user: "user",
      p_name: "Dewi Kartika",
    });
  });

  it("does not claim a save succeeded when storage rejected it", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023" } });
    await expect(saveProfileName("user", "Dewi")).rejects.toThrow("Your profile could not be saved. Please retry.");
  });
});

describe("adding a registration by BIB", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["a BIB with spaces", "A 1205"],
    ["a BIB with punctuation", "A1205!"],
    ["an empty BIB", ""],
    ["an overlong BIB", "A".repeat(41)],
  ])("refuses %s before any query", async (_label, value) => {
    await expect(linkRegistrationByBib("user", value)).rejects.toThrow(unavailableBibMessage);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a non-string BIB before any query", async () => {
    await expect(linkRegistrationByBib("user", 1205)).rejects.toBeInstanceOf(ProfileError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends the trimmed BIB with the verified account id", async () => {
    mocks.rpc.mockResolvedValue({ data: "linked", error: null });
    expect(await linkRegistrationByBib("user", " A1205 ")).toBe("linked");
    expect(mocks.rpc).toHaveBeenCalledWith("link_runner_by_bib", {
      p_user: "user",
      p_bib: "A1205",
    });
  });

  it("reports a BIB the account already holds without treating it as a failure", async () => {
    mocks.rpc.mockResolvedValue({ data: "already_yours", error: null });
    expect(await linkRegistrationByBib("user", "A1205")).toBe("already_yours");
  });

  it("surfaces the throttle as its own recoverable status", async () => {
    mocks.rpc.mockResolvedValue({ data: "throttled", error: null });
    await expect(linkRegistrationByBib("user", "A1205")).rejects.toMatchObject({ status: 429 });
  });

  it("gives an absent BIB and an owned BIB the same answer", async () => {
    // The database already answers both with 'unavailable'. This asserts the controller adds no
    // distinction of its own, because a difference here would confirm which BIBs exist.
    for (const data of ["unavailable", "something_unexpected", null]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(linkRegistrationByBib("user", "A1205")).rejects.toThrow(unavailableBibMessage);
    }
  });

  it("does not report a link when the call itself failed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(linkRegistrationByBib("user", "A1205")).rejects.toThrow(
      "Adding a BIB is temporarily unavailable. Please retry.",
    );
  });
});
