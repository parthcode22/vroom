import { handleUpgrade } from "../../workers/upgrade";

export { RoomDurableObject as CampusRoom } from "../../workers/room-do";

/**
 * The socket half of workers/app.ts, without the React Router request handler.
 * Everything the tests exercise — the upgrade guard, the Durable Object, its
 * SQLite — is the production code; only the SSR branch is absent.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") return handleUpgrade(request, env);
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
