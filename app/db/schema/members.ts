import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * One row per V Auth account that has entered V Rooms.
 *
 * There is deliberately NO email column and NO V Auth subject column. Both
 * already exist exactly once in better-auth's tables, and a second copy of the
 * most sensitive data in the system is the thing VRIP-04 exists to avoid. The
 * mapping VRIP-04 describes IS the foreign key `user_id`, and resolving it to a
 * human requires joining `user` — which only identity.server.ts does.
 */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // NULL until claimed. [a-z-] only, enforced by pseudonym.ts on the write path.
    pseudonym: text("pseudonym").unique(),
    // Granted out of band. Never self-service, never settable from a route.
    isModerator: boolean("is_moderator").notNull().default(false),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    // Tombstone. Soft delete, never hard delete.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("members_pseudonym_idx").on(t.pseudonym),
    index("members_suspended_at_idx").on(t.suspendedAt),
    index("members_is_moderator_idx").on(t.isModerator),
  ],
);

export type Member = typeof members.$inferSelect;
