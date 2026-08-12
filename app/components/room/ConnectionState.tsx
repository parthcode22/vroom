import type { ConnectionState as SocketState } from "~/lib/room-client";

export interface ConnectionStateProps {
  state: SocketState;
  killed: boolean;
}

/**
 * The one place the room admits something is wrong. Silent while the socket is
 * open and the room is live, because a permanent badge saying "connected" is
 * noise.
 */
export function ConnectionState({ state, killed }: ConnectionStateProps) {
  if (killed) return <span className="tag tag-dead">closed</span>;

  switch (state) {
    case "connecting":
      return <span className="tag">connecting</span>;
    case "reconnecting":
      return <span className="tag">reconnecting</span>;
    case "closed":
      return <span className="tag tag-dead">closed</span>;
    case "signed-out":
      return (
        <a className="tag no-underline" href="/">
          sign in again
        </a>
      );
    default:
      return null;
  }
}
