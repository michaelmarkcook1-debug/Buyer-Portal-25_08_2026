/**
 * WHO MAY REGISTER — buyers only, identified by a work email.
 *
 * The portal is buyer-side intelligence about service providers. Two kinds of
 * address are refused at sign-up:
 *   · personal mailboxes (Gmail, Outlook, iCloud …), which identify no
 *     organisation;
 *   · the covered service providers' own domains, so a vendor cannot register
 *     and read what the portal tells buyers about them.
 * The provider domains come from the live AG vendor catalog at request time,
 * so a vendor added to coverage is refused without a code change.
 *
 * Pure and dependency-free: the rules are unit-tested without a database.
 */

export type EmailVerdict =
  | { ok: true; email: string; domain: string }
  | { ok: false; reason: "invalid" | "personal" | "provider" };

/** Exact personal-mailbox domains. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  "yahoo.com", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
  "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.com", "email.com",
  "zoho.com", "zohomail.com", "yandex.com", "yandex.ru", "mail.ru",
  "qq.com", "163.com", "126.com", "sina.com", "naver.com",
  "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com", "tuta.io",
  "rediffmail.com", "btinternet.com", "sky.com", "virginmedia.com", "talktalk.net",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "orange.fr", "free.fr", "laposte.net", "libero.it", "t-online.de",
]);

/** Personal brands that appear under many country domains (hotmail.co.uk, yahoo.fr …). */
const PERSONAL_LABELS = new Set(["gmail", "googlemail", "hotmail", "outlook", "yahoo", "gmx", "yandex"]);

const EMAIL_SHAPE = /^[^\s@]{1,64}@(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The organisation label of a domain: "deloitte" for deloitte.co.uk or deloitte.com. */
function orgLabel(domain: string): string {
  const parts = domain.split(".");
  /* Two-part public suffixes (co.uk, com.au, co.in …) push the label one step left. */
  const twoPart = parts.length >= 3 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length === 2;
  return parts.at(twoPart ? -3 : -2) ?? domain;
}

/**
 * Does this email domain belong to a covered provider? Exact match or any
 * subdomain (uk.ibm.com). A country variant of the same organisation
 * (capgemini.co.uk against capgemini.com) is matched only for labels of five
 * or more characters: short labels such as "nice" or "ey" would otherwise
 * refuse unrelated buyers (nice.org.uk is a public body, not the vendor).
 */
export function isProviderDomain(domain: string, providerDomains: readonly string[]): boolean {
  for (const p of providerDomains) {
    const pd = p.trim().toLowerCase();
    if (!pd) continue;
    if (domain === pd || domain.endsWith(`.${pd}`)) return true;
    const label = orgLabel(pd);
    if (label.length >= 5 && orgLabel(domain) === label) return true;
  }
  return false;
}

export function isPersonalDomain(domain: string): boolean {
  return PERSONAL_DOMAINS.has(domain) || PERSONAL_LABELS.has(orgLabel(domain));
}

export function checkBuyerEmail(raw: string, providerDomains: readonly string[]): EmailVerdict {
  const email = normaliseEmail(raw);
  if (email.length > 254 || !EMAIL_SHAPE.test(email)) return { ok: false, reason: "invalid" };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (isPersonalDomain(domain)) return { ok: false, reason: "personal" };
  if (isProviderDomain(domain, providerDomains)) return { ok: false, reason: "provider" };
  return { ok: true, email, domain };
}

/**
 * What the form says. Deliberately the same sentence for a personal and a
 * provider address: telling a vendor exactly why it was refused helps no one.
 */
export const REFUSAL_MESSAGE: Record<"invalid" | "personal" | "provider", string> = {
  invalid: "That doesn't look like a complete email address.",
  personal: "Please use your organisation's work email. Personal and service-provider addresses can't register.",
  provider: "Please use your organisation's work email. Personal and service-provider addresses can't register.",
};
