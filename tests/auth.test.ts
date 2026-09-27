import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBuyerEmail, isPersonalDomain, isProviderDomain } from "@/lib/auth/email-policy";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySession } from "@/lib/auth/token";

const PROVIDERS = ["accenture.com", "tcs.com", "capgemini.com", "nice.com", "ey.com", "ibm.com"];
const SECRET = "x".repeat(40);
const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("who may register", () => {
  it("accepts a buyer's work email", () => {
    const v = checkBuyerEmail("  Jane.Doe@BigBank.co.uk ", PROVIDERS);
    expect(v).toEqual({ ok: true, email: "jane.doe@bigbank.co.uk", domain: "bigbank.co.uk" });
  });

  it("refuses personal mailboxes, including country variants", () => {
    for (const e of ["a@gmail.com", "a@hotmail.co.uk", "a@yahoo.fr", "a@icloud.com", "a@proton.me", "a@outlook.de"]) {
      expect(checkBuyerEmail(e, PROVIDERS), e).toEqual({ ok: false, reason: "personal" });
    }
  });

  it("refuses the covered providers, their subdomains and longer-label country variants", () => {
    for (const e of ["a@accenture.com", "a@uk.ibm.com", "a@capgemini.co.uk", "a@tcs.com"]) {
      expect(checkBuyerEmail(e, PROVIDERS), e).toEqual({ ok: false, reason: "provider" });
    }
  });

  it("does not refuse unrelated organisations that share a short label", () => {
    // nice.org.uk is a public body and a potential buyer, not the vendor nice.com
    expect(isProviderDomain("nice.org.uk", PROVIDERS)).toBe(false);
    expect(isProviderDomain("ey.co.uk", PROVIDERS)).toBe(false);
    expect(checkBuyerEmail("buyer@nice.org.uk", PROVIDERS).ok).toBe(true);
  });

  it("refuses malformed addresses", () => {
    for (const e of ["", "no-at-sign", "a@b", "a@@b.com", "a b@c.com"]) {
      expect(checkBuyerEmail(e, PROVIDERS), e).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("knows the common personal brands", () => {
    expect(isPersonalDomain("gmail.com")).toBe(true);
    expect(isPersonalDomain("bigbank.com")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips an authentic token", async () => {
    const t = await signSession("user-1", SECRET);
    expect((await verifySession(t, SECRET))?.uid).toBe("user-1");
  });

  it("rejects a tampered payload, a wrong secret and a weak secret", async () => {
    const t = await signSession("user-1", SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9_999_999_999, v: 1 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${body}.${sig}x`, SECRET)).toBeNull();
    expect(await verifySession(t, "y".repeat(40))).toBeNull();
    expect(await verifySession(t, "short")).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await signSession("user-1", SECRET, Date.parse("2020-01-01"));
    expect(await verifySession(t, SECRET)).toBeNull();
  });
});

describe("passwords", () => {
  it("hashes with a salt and verifies only the right password", async () => {
    const h1 = await hashPassword("correct horse battery");
    const h2 = await hashPassword("correct horse battery");
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("correct horse battery", h1)).toBe(true);
    expect(await verifyPassword("wrong horse battery", h1)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("sets a floor and refuses the email name", () => {
    expect(passwordProblem("short", "jane@x.com")).toMatch(/12 characters/);
    expect(passwordProblem("janedoe-is-great-1", "janedoe@x.com")).toMatch(/email name/);
    expect(passwordProblem("a perfectly fine phrase", "a@x.com")).toBeNull();
  });
});

describe("access is closed by default", () => {
  it("middleware guards everything but sign-in, sign-up and static assets", () => {
    const mw = src("middleware.ts");
    expect(mw).toMatch(/verifySession\(/);
    expect(mw).toMatch(/\?!login\|join\|api\/auth\|_next\/static/);
    expect(mw).toMatch(/status: 401/);
  });

  it("the Backoffice page and its API are admin-only", () => {
    expect(src("app/backoffice/page.tsx")).toMatch(/await requireAdmin\(\)/);
    const api = src("app/api/backoffice/refresh/route.ts");
    expect(api.match(/const denied = await adminOnly\(\)/g)?.length).toBe(2);
    expect(api).toMatch(/user\.role !== "admin"/);
  });

  it("admin comes only from ADMIN_EMAILS, never from the sign-up form", () => {
    const signup = src("app/api/auth/signup/route.ts");
    expect(signup).toMatch(/roleFor\(verdict\.email\)/);
    expect(signup).not.toMatch(/form\.get\("role"\)/);
  });

  it("the footer shows the Backoffice only to admins", () => {
    expect(src("components/PortalShell.tsx")).toMatch(/ctx\.user\.role === "admin" \? \(\s*<Link\s+href="\/backoffice"/);
  });
});
