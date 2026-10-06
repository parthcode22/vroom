import { createRequestHandler } from "react-router";

import { handleUpgrade } from "./upgrade";

// The Durable Object class ships from the same Worker entry, so the console
// reaches it through a binding rather than a second auth mechanism (VRIP-06).
// Exported as CampusRoom, the class name wrangler.jsonc binds (migration v2).
// The RoomDurableObject export binds nothing, but Cloudflare rejects a deploy
// that drops a class with stored objects (error 10064). It goes in the same
// deploy as the deleted_classes migration that erases those objects.
export { RoomDurableObject, RoomDurableObject as CampusRoom } from "./room-do";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    void ctx;
    // createRequestHandler has no useful way to return a 101, so the socket
    // path is checked before React Router ever sees the request.
    if (new URL(request.url).pathname === "/ws") {
      return handleUpgrade(request, env);
    }
    return requestHandler(request);
  },
} satisfies ExportedHandler<Env>;
