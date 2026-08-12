/**
 * Grants or revokes the moderator role. Deliberately NOT reachable from any
 * route: `is_moderator` is granted out of band, never self-service, so this
 * script talks straight to the database rather than through the API the way
 * scripts/mod.ts does.
 *
 * Usage:
 *   npm run promote -- someone@vit.edu.in
 *   npm run promote -- someone@vit.edu.in --revoke
 *   npm run promote -- --list
 *
 * Reads DIRECT_URL or DATABASE_URL from .env.
 */

import { config } from "dotenv";

config({ path: ".env" });

import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list = args.includes("--list");
const email = args.find((a) => !a.startsWith("--"));

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const sql = neon(url);

async function main(): Promise<void> {
  if (list) {
    const rows = await sql`
      SELECT u.email, m.pseudonym, m.suspended_at
      FROM members m JOIN "user" u ON u.id = m.user_id
      WHERE m.is_moderator = true AND m.deleted_at IS NULL
      ORDER BY u.email`;
    if (rows.length === 0) {
      console.log(
        "No moderators. Nobody can reach the console or the kill switch.",
      );
      return;
    }
    console.log(`${rows.length} moderator(s):`);
    for (const r of rows) {
      const state = r.suspended_at ? " (suspended, so the role is inert)" : "";
      console.log(`  ${r.email}  handle=${r.pseudonym ?? "unclaimed"}${state}`);
    }
    return;
  }

  if (!email) {
    console.error("Usage: npm run promote -- <email> [--revoke] | --list");
    process.exit(1);
  }

  // The member row only exists once the person has signed in at least once.
  const found = await sql`
    SELECT m.id, m.pseudonym, m.is_moderator
    FROM members m JOIN "user" u ON u.id = m.user_id
    WHERE lower(u.email) = lower(${email}) AND m.deleted_at IS NULL`;

  if (found.length === 0) {
    console.error(`No V Rooms member for ${email}.`);
    console.error("They must sign in once before the role can be granted.");
    process.exit(1);
  }

  const member = found[0];
  const next = !revoke;
  if (member.is_moderator === next) {
    console.log(
      `${email} is already ${next ? "a moderator" : "not a moderator"}.`,
    );
    return;
  }

  await sql`UPDATE members SET is_moderator = ${next}, updated_at = now() WHERE id = ${member.id}`;
  console.log(
    `${next ? "Granted" : "Revoked"} moderator for ${email} (${member.pseudonym ?? "unclaimed"}).`,
  );

  if (next && member.pseudonym) {
    console.log(
      `Set MOD_SCRIPT_MEMBER_HANDLE=${member.pseudonym} so the script door works.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
