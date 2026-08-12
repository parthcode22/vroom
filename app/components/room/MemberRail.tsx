import { BRAND, cn, handleColour } from "~/lib/utils";

export interface MemberListProps {
  members: string[];
  self: string;
}

/** Shared by the right rail and the member sheet, so the two cannot drift. */
export function MemberList({ members, self }: MemberListProps) {
  if (members.length === 0) {
    return <div className="empty">nobody is online right now</div>;
  }
  return (
    <>
      {members.map((who) => {
        const mine = who === self;
        return (
          <div key={who} className={cn("member", mine && "self")}>
            <i style={{ background: handleColour(who, self) }} />
            <span
              className={mine ? undefined : "text-ink-2"}
              style={mine ? { color: BRAND } : undefined}
            >
              {mine ? `${who} (you)` : who}
            </span>
          </div>
        );
      })}
    </>
  );
}

export interface MemberRailProps {
  members: string[];
  self: string;
}

export function MemberRail({ members, self }: MemberRailProps) {
  return (
    <aside className="members" aria-label="Online now">
      <div className="rail-label">
        Online <span>{members.length}</span>
      </div>
      <MemberList members={members} self={self} />
    </aside>
  );
}
