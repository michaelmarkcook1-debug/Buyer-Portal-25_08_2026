/**
 * Create (or reset) an admin account — the only way an admin is made.
 *
 *   pnpm admin:create someone@yourcompany.com
 *
 * The address must already be on ADMIN_EMAILS. The password is typed at a
 * hidden prompt, never passed as an argument (it would sit in shell history).
 * Writes one row to the portal-owned portal_user table and nothing else.
 * Re-running for an existing address resets its password, clears any lock
 * and marks it admin.
 *
 * The sign-up link can never create an admin: it does not prove the person
 * owns the mailbox, so an invitee could otherwise register the admin's
 * address (audit 5 Nov 2026).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { normaliseEmail } from "@/lib/auth/email-policy";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { authConfig } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/auth/users";
import { q } from "@/lib/db";

function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    let asked = false;
    out._writeToOutput = (s: string) => {
      if (!asked) {
        process.stdout.write(s);
        asked = true;
      }
    };
    rl.question(label, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const email = normaliseEmail(process.argv[2] ?? "");
  if (!email.includes("@")) throw new Error("Usage: pnpm admin:create someone@yourcompany.com");
  if (!authConfig().adminEmails.has(email)) {
    throw new Error("That address is not on ADMIN_EMAILS. Add it there first (locally and in Vercel).");
  }
  const password = await hiddenPrompt("New admin password (hidden): ");
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);
  if ((await hiddenPrompt("Repeat it: ")) !== password) throw new Error("The two passwords don't match.");

  await findUserByEmail(email); // ensures the table exists
  const hash = await hashPassword(password);
  await q(
    `INSERT INTO portal_user (id, email, email_domain, role, password_hash)
     VALUES ($1, $2, $3, 'admin', $4)
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin', password_hash = EXCLUDED.password_hash,
           failed_logins = 0, locked_until = NULL, disabled = false`,
    [randomUUID(), email, email.split("@")[1], hash],
  );
  console.log("Admin account ready. Sign in at /login.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
