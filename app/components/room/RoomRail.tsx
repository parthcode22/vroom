import { cn } from "~/lib/utils";

/** The four rooms that do not exist yet. Each one is an open GitHub issue. */
const UNBUILT = ["placements", "electives", "hostel", "projects"] as const;

export interface HandlePanelProps {
  pseudonym: string;
  blockCount: number;
  onClearBlocks: () => void;
  className?: string;
}

/** Pinned to the foot of the rail, and reused inside the member sheet. */
export function HandlePanel({
  pseudonym,
  blockCount,
  onClearBlocks,
  className,
}: HandlePanelProps) {
  const blocking = blockCount > 0;
  return (
    <div className={cn("rail-me", className)}>
      <i />
      <div className="min-w-0 flex-1">
        <div className="rail-me-name">{pseudonym || "assigning a handle"}</div>
        <div className="rail-me-sub">yours, permanently</div>
      </div>
      <button
        type="button"
        className="rail-me-btn disabled:cursor-default disabled:opacity-45"
        disabled={!blocking}
        onClick={onClearBlocks}
        title={
          blocking
            ? "Show their messages again. Blocking only hides them on this device."
            : "Blocking hides someone's messages on this device."
        }
        aria-label={
          blocking
            ? `Show messages from the ${blockCount} handles you blocked`
            : "You have not blocked anyone"
        }
      >
        {blocking ? `blocks ${blockCount}` : "blocks"}
      </button>
    </div>
  );
}

export interface RoomRailProps {
  pseudonym: string;
  blockCount: number;
  onClearBlocks: () => void;
}

export function RoomRail({
  pseudonym,
  blockCount,
  onClearBlocks,
}: RoomRailProps) {
  return (
    <nav className="rail" aria-label="Rooms">
      <div className="rail-scroll">
        <div className="rail-label">Rooms</div>
        <button type="button" className="rail-item active" aria-current="true">
          <span className="rail-hash">#</span> campus-live
        </button>

        <div className="rail-label">
          Not built yet <span>{UNBUILT.length}</span>
        </div>
        {UNBUILT.map((name) => (
          <button
            key={name}
            type="button"
            className="rail-item locked"
            disabled
          >
            <span className="rail-hash">#</span> {name}
            <span className="rail-issue">issue</span>
          </button>
        ))}

        <p className="rail-note">
          Each one is an open issue. Claim it and it ships under your name.
        </p>
      </div>

      <HandlePanel
        pseudonym={pseudonym}
        blockCount={blockCount}
        onClearBlocks={onClearBlocks}
      />
    </nav>
  );
}
