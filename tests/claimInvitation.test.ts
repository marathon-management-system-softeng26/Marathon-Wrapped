import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock("@/lib/mail/mailer", async (original) => ({
  ...(await original<object>()),
  sendMail: mocks.sendMail,
}));

import { MailError } from "@/lib/mail/mailer";
import { claimInvitationMessage, claimUrl, sendClaimInvitation } from "@/lib/mail/claimInvitation";

const token = "A".repeat(43);

const invitation = {
  to: "runner@example.com",
  runnerName: "Dewi Lestari",
  eventName: "Soekarno Run 2027",
  token,
  expiresAt: "2026-11-19T12:00:00.000Z",
};

beforeEach(() => {
  process.env.APP_URL = "https://marathon-wrapped.example.app";
  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue({ messageId: "<sent@brevo>" });
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.NODE_ENV_OVERRIDE;
});

describe("claimUrl", () => {
  it("puts the token in the claim query of the application root", () => {
    expect(claimUrl(token)).toBe(`https://marathon-wrapped.example.app/?claim=${token}`);
  });

  it("reports a missing APP_URL as unconfigured", () => {
    delete process.env.APP_URL;
    expect(() => claimUrl(token)).toThrow(/not_configured/);
  });

  it("allows a development host over http", () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(claimUrl(token)).toBe(`http://localhost:3000/?claim=${token}`);
  });

  for (const value of [
    "http://marathon-wrapped.example.app",
    "https://user:secret@marathon-wrapped.example.app",
    "https://marathon-wrapped.example.app/runners",
    "https://marathon-wrapped.example.app/?claim=other",
    "https://marathon-wrapped.example.app/#fragment",
    "not-a-url",
    "javascript:alert(1)",
  ]) {
    it(`refuses the unusable APP_URL ${value}`, () => {
      process.env.APP_URL = value;
      expect(() => claimUrl(token)).toThrow(/not_configured/);
    });
  }

  for (const value of ["", "short", `${token}=`, `${token}A`, "A".repeat(42), "../../etc/passwd"]) {
    it(`refuses the non-token ${JSON.stringify(value)}`, () => {
      expect(() => claimUrl(value)).toThrow(/invalid_token/);
    });
  }
});

describe("claimInvitationMessage", () => {
  it("names the event in the subject", () => {
    expect(claimInvitationMessage(invitation).subject).toBe("Claim your Soekarno Run 2027 registration");
  });

  it("falls back to a generic subject with no event name", () => {
    expect(claimInvitationMessage({ ...invitation, eventName: null }).subject).toBe(
      "Claim your race registration",
    );
  });

  it("carries the link, the token, and the Jakarta expiry in the text part", () => {
    const { text } = claimInvitationMessage(invitation);

    expect(text).toContain(`https://marathon-wrapped.example.app/?claim=${token}`);
    expect(text).toContain(token);
    expect(text).toContain("Dewi Lestari");
    expect(text).toContain("19 Nov 2026");
    expect(text).toContain("19:00");
    expect(text).toContain("WIB");
  });

  it("links and shows the token in the html part", () => {
    const { html } = claimInvitationMessage(invitation);

    expect(html).toContain(`href="https://marathon-wrapped.example.app/?claim=${token}"`);
    expect(html).toContain(token);
  });

  it("escapes a name that would otherwise inject markup", () => {
    const { html, text } = claimInvitationMessage({
      ...invitation,
      runnerName: `<script>alert("x")</script>`,
      eventName: "Ben & Jerry's <Run>",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Ben &amp; Jerry&#39;s &lt;Run&gt;");
    // The text part is not markup, so it stays readable and unescaped.
    expect(text).toContain("Ben & Jerry's <Run>");
  });

  it("keeps a quoted name out of the surrounding attributes", () => {
    const { html } = claimInvitationMessage({ ...invitation, runnerName: `" onmouseover="steal()` });

    expect(html).not.toContain(`onmouseover="steal()`);
    expect(html).toContain("&quot; onmouseover=&quot;steal()");
  });

  it("tells the runner the code is single use", () => {
    const { text, html } = claimInvitationMessage(invitation);

    expect(text.toLowerCase()).toContain("once");
    expect(html.toLowerCase()).toContain("once");
  });
});

describe("sendClaimInvitation", () => {
  it("hands the composed message to the mailer", async () => {
    await sendClaimInvitation(invitation);

    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const sent = mocks.sendMail.mock.calls[0][0];
    expect(sent.to).toBe("runner@example.com");
    expect(sent.subject).toBe("Claim your Soekarno Run 2027 registration");
    expect(sent.text).toContain(token);
    expect(sent.html).toContain(token);
  });

  it("refuses to send before composing when APP_URL is missing", async () => {
    delete process.env.APP_URL;

    await expect(sendClaimInvitation(invitation)).rejects.toThrow(/not_configured/);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("passes a mailer failure through unchanged", async () => {
    mocks.sendMail.mockRejectedValue(new MailError("rate_limited", 503, true));

    const failure = await sendClaimInvitation(invitation).catch((cause) => cause);
    expect(failure).toBeInstanceOf(MailError);
    expect(failure.code).toBe("rate_limited");
  });
});
