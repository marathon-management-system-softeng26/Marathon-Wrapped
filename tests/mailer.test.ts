import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
  createTransport: mocks.createTransport,
}));

import { MailError, resetMailTransport, sendMail, validateMailConfiguration } from "@/lib/mail";

const brevo = {
  SMTP_HOST: "smtp-relay.brevo.com",
  SMTP_PORT: "587",
  SMTP_USER: "90abcd001@smtp-brevo.com",
  SMTP_PASSWORD: "xsmtpsib-secret",
  MAIL_FROM_ADDRESS: "no-reply@soekarnorun.id",
  MAIL_FROM_NAME: "Marathon Wrapped",
};

const keys = [...Object.keys(brevo), "MAIL_REPLY_TO"] as const;

function configure(overrides: Record<string, string | undefined> = {}) {
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries({ ...brevo, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const letter = { to: "runner@example.com", subject: "Your claim code", text: "Code: 123456" };

beforeEach(() => {
  configure();
  resetMailTransport();
  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue({ messageId: "<sent@brevo>", rejected: [] });
  mocks.createTransport.mockReset();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
});

afterEach(() => {
  configure({ MAIL_FROM_NAME: undefined });
  for (const key of keys) delete process.env[key];
  resetMailTransport();
});

describe("validateMailConfiguration", () => {
  it("reads the SMTP contract from the environment", () => {
    expect(validateMailConfiguration()).toEqual({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      user: "90abcd001@smtp-brevo.com",
      password: "xsmtpsib-secret",
      from: { name: "Marathon Wrapped", address: "no-reply@soekarnorun.id" },
      replyTo: null,
    });
  });

  it("treats the implicit TLS port as secure", () => {
    configure({ SMTP_PORT: "465" });
    expect(validateMailConfiguration()).toMatchObject({ port: 465, secure: true });
  });

  it("carries an optional reply-to address", () => {
    configure({ MAIL_REPLY_TO: "organizer@soekarnorun.id" });
    expect(validateMailConfiguration().replyTo).toBe("organizer@soekarnorun.id");
  });

  it("falls back to a bare sender when no display name is set", () => {
    configure({ MAIL_FROM_NAME: undefined });
    expect(validateMailConfiguration().from).toEqual({ address: "no-reply@soekarnorun.id", name: "" });
  });

  for (const key of Object.keys(brevo).filter((name) => name !== "MAIL_FROM_NAME")) {
    it(`reports a missing ${key} as unconfigured`, () => {
      configure({ [key]: undefined });
      expect(() => validateMailConfiguration()).toThrow(MailError);
      expect(() => validateMailConfiguration()).toThrow(/not_configured/);
    });
  }

  for (const port of ["0", "70000", "five-eight-seven", "587.5"]) {
    it(`rejects the unusable port ${port}`, () => {
      configure({ SMTP_PORT: port });
      expect(() => validateMailConfiguration()).toThrow(/not_configured/);
    });
  }

  it("rejects a sender address that is not a single mailbox", () => {
    configure({ MAIL_FROM_ADDRESS: "no-reply@soekarnorun.id, extra@elsewhere.test" });
    expect(() => validateMailConfiguration()).toThrow(/not_configured/);
  });

  it("rejects a display name carrying header bytes", () => {
    configure({ MAIL_FROM_NAME: "Wrapped\r\nBcc: leak@elsewhere.test" });
    expect(() => validateMailConfiguration()).toThrow(/not_configured/);
  });
});

describe("sendMail", () => {
  it("delivers through a pooled transport built from the contract", async () => {
    await sendMail(letter);

    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.createTransport.mock.calls[0][0]).toMatchObject({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      requireTLS: true,
      pool: true,
      auth: { user: "90abcd001@smtp-brevo.com", pass: "xsmtpsib-secret" },
    });
  });

  it("bounds every network phase so a stalled server cannot hold the handler", async () => {
    await sendMail(letter);

    const options = mocks.createTransport.mock.calls[0][0];
    for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      expect(options[key]).toBeGreaterThan(0);
      expect(options[key]).toBeLessThanOrEqual(15000);
    }
  });

  it("reuses one transport across sends", async () => {
    await sendMail(letter);
    await sendMail({ ...letter, to: "second@example.com" });

    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("sends the envelope the caller asked for and marks it machine-generated", async () => {
    const result = await sendMail({ ...letter, html: "<p>Code: 123456</p>" });

    expect(result).toEqual({ messageId: "<sent@brevo>" });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: { name: "Marathon Wrapped", address: "no-reply@soekarnorun.id" },
      to: "runner@example.com",
      subject: "Your claim code",
      text: "Code: 123456",
      html: "<p>Code: 123456</p>",
      headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
    });
  });

  it("omits an html part that was not supplied", async () => {
    await sendMail(letter);
    expect(mocks.sendMail.mock.calls[0][0]).not.toHaveProperty("html");
  });

  it("attaches a reply-to only when one is configured", async () => {
    configure({ MAIL_REPLY_TO: "organizer@soekarnorun.id" });
    await sendMail(letter);
    expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({ replyTo: "organizer@soekarnorun.id" });
  });

  for (const to of [
    "runner@example.com\r\nBcc: leak@elsewhere.test",
    "runner@example.com\nBcc: leak@elsewhere.test",
    "runner@example.com, second@example.com",
    "Runner <runner@example.com>",
    "runner-at-example.com",
    "runner@",
    "@example.com",
    "",
    "   ",
  ]) {
    it(`refuses the unusable recipient ${JSON.stringify(to)}`, async () => {
      await expect(sendMail({ ...letter, to })).rejects.toThrow(/invalid_recipient/);
      expect(mocks.sendMail).not.toHaveBeenCalled();
    });
  }

  it("refuses a recipient longer than an address can be", async () => {
    const to = `${"r".repeat(250)}@example.com`;
    await expect(sendMail({ ...letter, to })).rejects.toThrow(/invalid_recipient/);
  });

  it("refuses a subject carrying header bytes", async () => {
    await expect(sendMail({ ...letter, subject: "Code\r\nBcc: leak@elsewhere.test" })).rejects.toThrow(
      /invalid_subject/,
    );
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("refuses an empty subject or body", async () => {
    await expect(sendMail({ ...letter, subject: "  " })).rejects.toThrow(/invalid_subject/);
    await expect(sendMail({ ...letter, text: "" })).rejects.toThrow(/invalid_body/);
  });

  it("trims a surrounding whitespace from the recipient", async () => {
    await sendMail({ ...letter, to: "  runner@example.com  " });
    expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({ to: "runner@example.com" });
  });

  it("reports a refused mailbox as a delivery failure", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "<sent@brevo>", rejected: ["runner@example.com"] });
    await expect(sendMail(letter)).rejects.toThrow(/delivery_failed/);
  });

  it("surfaces an authentication rejection as a configuration fault", async () => {
    mocks.sendMail.mockRejectedValue(Object.assign(new Error("535 authentication failed"), { responseCode: 535 }));

    const failure = await sendMail(letter).catch((cause) => cause);
    expect(failure).toBeInstanceOf(MailError);
    expect(failure.code).toBe("not_authenticated");
    expect(failure.status).toBe(503);
  });

  it("marks a throttled relay as retryable", async () => {
    mocks.sendMail.mockRejectedValue(Object.assign(new Error("421 too many messages"), { responseCode: 421 }));

    const failure = await sendMail(letter).catch((cause) => cause);
    expect(failure.code).toBe("rate_limited");
    expect(failure.retryable).toBe(true);
  });

  it("never leaks the recipient, the password, or the relay response", async () => {
    mocks.sendMail.mockRejectedValue(new Error("550 unknown mailbox runner@example.com xsmtpsib-secret"));

    const failure = await sendMail(letter).catch((cause) => cause);
    const exposed = `${failure.message} ${failure.stack ?? ""}`;
    expect(exposed).not.toContain("runner@example.com");
    expect(exposed).not.toContain("xsmtpsib-secret");
    expect(exposed).not.toContain("unknown mailbox");
  });

  it("drops the transport after a connection fault so the next send reconnects", async () => {
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }));

    await expect(sendMail(letter)).rejects.toThrow(MailError);
    await sendMail(letter);

    expect(mocks.createTransport).toHaveBeenCalledTimes(2);
  });

  it("keeps the transport after a per-recipient rejection", async () => {
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("550 no such user"), { responseCode: 550 }));

    await expect(sendMail(letter)).rejects.toThrow(MailError);
    await sendMail(letter);

    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
  });

  it("fails closed before touching the network when SMTP is unconfigured", async () => {
    configure({ SMTP_PASSWORD: undefined });
    await expect(sendMail(letter)).rejects.toThrow(/not_configured/);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
