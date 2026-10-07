/**
 * The second front door (VRIP-05, VRIP-08). The console being down must not
 * remove the remedy.
 *
 * Usage:
 *   npm run mod -- close "reports arriving faster than we can act"
 *   npm run mod -- open
 *   npm run mod -- suspend quiet-ibex "targeted a named student"
 *   npm run mod -- restore quiet-ibex
 *   npm run mod -- delete <reportId>
 *   npm run mod -- dismiss <reportId>
 *
 * Reads MOD_SCRIPT_TOKEN and VROOMS_ORIGIN from the environment. It talks HTTP
 * to the deployment rather than the database, so it goes through the same
 * moderation module as the console and cannot bypass the audit trail.
 */

import { config } from "dotenv";

config({ path: ".env" });

interface ApiSuccess {
  data: Record<string, unknown>;
}
interface ApiFailure {
  error: { code: string; message: string };
}

const USAGE = `
v-rooms moderation

  close [reason]            close the room for everyone
  open                      reopen the room
  suspend <handle> [reason] suspend an account and close its sockets
  restore <handle>          lift a suspension
  delete <reportId>         delete the reported message
  dismiss <reportId>        close a report with no action

Environment: MOD_SCRIPT_TOKEN, VROOMS_ORIGIN
`.trim();

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function call(
  action: string,
  body: Record<string, unknown>,
): Promise<void> {
  const origin = process.env.VROOMS_ORIGIN;
  const token = process.env.MOD_SCRIPT_TOKEN;
  if (!origin) die("VROOMS_ORIGIN is not set.");
  if (!token) die("MOD_SCRIPT_TOKEN is not set.");

  const response = await fetch(new URL(`/api/mod/${action}`, origin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    ApiSuccess | ApiFailure | null;

  if (!response.ok || !payload || "error" in payload) {
    const error = payload && "error" in payload ? payload.error : null;
    die(
      `[FAIL] ${response.status} ${error?.code ?? "unknown"}: ${error?.message ?? "no body"}`,
    );
  }

  // The script prints the audit row it caused, so the operator sees the record
  // exist rather than trusting that it did.
  console.log(`[OK] ${action}`);
  console.log(JSON.stringify(payload.data, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "close":
      return call("set_room_state", { killed: true, reason: rest[0] ?? null });
    case "open":
      return call("set_room_state", { killed: false });
    case "suspend":
      if (!rest[0]) die("suspend needs a handle.");
      return call("suspend", { handle: rest[0], reason: rest[1] ?? null });
    case "restore":
      if (!rest[0]) die("restore needs a handle.");
      return call("restore", { handle: rest[0] });
    case "delete":
      if (!rest[0]) die("delete needs a report id.");
      return call("delete_message", { reportId: rest[0] });
    case "dismiss":
      if (!rest[0]) die("dismiss needs a report id.");
      return call("dismiss_report", { reportId: rest[0] });
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => die(String(error)));
