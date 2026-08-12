import { memo } from "react";

import type { Msg } from "../../../workers/protocol";
import { clockTime, cn, handleColour } from "~/lib/utils";

export interface MessageRowProps {
  msg: Msg;
  /** Your own handle: colours you brand orange and hides the actions. */
  self: string;
  blocked: boolean;
  deleted: boolean;
  reported: boolean;
  onReport: (msg: Msg) => void;
  onBlock: (who: string) => void;
}

function Row({
  msg,
  self,
  blocked,
  deleted,
  reported,
  onReport,
  onBlock,
}: MessageRowProps) {
  const mine = msg.who === self;
  const actionable = !mine && !deleted && !blocked;

  let body = msg.body;
  if (deleted) body = "message removed by a moderator";
  else if (blocked) body = "you blocked this person";

  return (
    <div className={cn("row", deleted && "deleted", blocked && "blocked")}>
      <span
        className="row-handle"
        style={blocked ? undefined : { color: handleColour(msg.who, self) }}
      >
        {blocked ? "blocked:" : `${msg.who}:`}
      </span>
      <span className="row-body">{body}</span>
      <span className="row-time">{clockTime(msg.at)}</span>

      {actionable ? (
        <div className="row-act">
          <button
            type="button"
            className="row-btn disabled:cursor-default disabled:opacity-60"
            disabled={reported}
            aria-label={
              reported
                ? `Message from ${msg.who} already reported`
                : `Report message from ${msg.who}`
            }
            onClick={() => onReport(msg)}
          >
            {reported ? "reported" : "report"}
          </button>
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

/**
 * Memoised because the log is never rebuilt: appending one message must leave
 * every existing row's element untouched, which only holds if the props of the
 * untouched rows are referentially stable.
 */
export const MessageRow = memo(Row);
