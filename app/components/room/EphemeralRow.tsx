import { memo, useEffect, useState } from "react";

import type { EphemeralMsg } from "../../../workers/protocol";
import { cn, handleColour } from "~/lib/utils";

export interface EphemeralRowProps {
  msg: EphemeralMsg;
  /** When this row is removed, fixed at arrival so the countdown never drifts. */
  expiresAt: number;
  self: string;
  blocked: boolean;
  onBlock: (who: string) => void;
}

function remaining(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

/**
 * A message that was broadcast and never written down (VRIP-10).
 *
 * The countdown is the visible part, but it is not the point the row has to
 * make: "not saved" is, because the property is the absence of the write and
 * not the disappearance. A row that only faded away would read as a delete,
 * which is a different and weaker promise.
 *
 * There is no report action. Reporting reads the message back from the store to
 * snapshot it, and this one is not there — so the button would 404 every time.
 * Blocking still works, because it acts on the handle and not the message.
 */
function Row({ msg, expiresAt, self, blocked, onBlock }: EphemeralRowProps) {
  const [left, setLeft] = useState(() => remaining(expiresAt));

  useEffect(() => {
    const tick = setInterval(() => setLeft(remaining(expiresAt)), 1000);
    return () => clearInterval(tick);
  }, [expiresAt]);

  return (
    <div className={cn("row", "row-temp", blocked && "blocked")}>
      <span
        className="row-handle"
        style={blocked ? undefined : { color: handleColour(msg.who, self) }}
      >
        {blocked ? "blocked:" : `${msg.who}:`}
      </span>
      <span className="row-body">
        {blocked ? "you blocked this person" : msg.body}
      </span>
      <span className="row-tag" title="Never written to the room's history.">
        not saved · {left}s
      </span>

      {msg.who !== self && !blocked ? (
        <div className="row-act">
          <button
            type="button"
            className="row-btn danger"
            aria-label={`Block ${msg.who}`}
            title="Hides their messages on this device. They stay in the room."
            onClick={() => onBlock(msg.who)}
          >
            block
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Memoised for the same reason MessageRow is: the log is never rebuilt. */
export const EphemeralRow = memo(Row);
