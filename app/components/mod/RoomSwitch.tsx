import { useFetcher } from "react-router";

import { ERROR_NOTE } from "./RowMenu";
import type { ModActionData } from "~/routes/mod";

/**
 * The kill switch. It is Durable Object state, not an environment variable, so
 * it takes effect on the next frame for everyone in the room (VRIP-05).
 */

const OPEN_COPY =
  "Closing the room freezes it for everyone within a second. History stays readable, nobody can " +
  "post. Use it when reports arrive faster than you can act on them.";

const CLOSED_COPY =
  "Nobody can post. History stays readable, and the room says so rather than looking broken. " +
  "Reopen when you have hands on it.";

const UNKNOWN_COPY =
  "The room is unreachable, so its state cannot be read or changed right now. The report queue " +
  "below is unaffected.";

interface RoomSwitchProps {
  /** null when the Durable Object could not be read. */
  killed: boolean | null;
}

export function RoomSwitch({ killed }: RoomSwitchProps) {
  const fetcher = useFetcher<ModActionData>();
  const submitting = fetcher.state !== "idle";
  const submitted = submitting
    ? fetcher.formData?.get("killed") === "true"
    : null;

  const closed = submitted ?? killed ?? false;
  const unknown = killed === null && submitted === null;

  return (
    <section className="sec">
      <fetcher.Form method="post" className="roomctl">
        <input type="hidden" name="intent" value="set_room_state" />
        <input type="hidden" name="killed" value={String(!closed)} />

        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-[9px] text-[15px] font-semibold">
            Room status
            <span
              className={
                unknown ? "badge" : closed ? "badge badge-no" : "badge badge-ok"
              }
            >
              {unknown ? "Unknown" : closed ? "Closed" : "Open"}
            </span>
          </h2>
          <p className="text-ink-2 mt-1 max-w-[72ch] text-[13px] leading-[1.55]">
            {unknown ? UNKNOWN_COPY : closed ? CLOSED_COPY : OPEN_COPY}
          </p>
          {fetcher.data?.error && (
            <p role="alert" className={`${ERROR_NOTE} mt-2`}>
              {fetcher.data.error.code}: {fetcher.data.error.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          className="sw disabled:cursor-not-allowed disabled:opacity-40"
          role="switch"
          aria-checked={closed}
          aria-label={closed ? "Open the room" : "Close the room"}
          disabled={unknown || submitting}
        />
      </fetcher.Form>
    </section>
  );
}
