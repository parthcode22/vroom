import { redirect } from "react-router";

import { DEFAULT_ROOM_ID } from "~/lib/rooms";

/** `/room` is the entry point everything links to; the default room is where it lands. */
export function loader() {
  throw redirect(`/room/${DEFAULT_ROOM_ID}`);
}
