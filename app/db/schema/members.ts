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
 * One row per student device key, or per moderator's V Auth account (VRIP-13).
 *
 * A student row carries `key_hash`, the sha256 of the browser's public key, and
 * nothing that names a person. A moderator row carries `user_id`. Migration
 * 0003 adds the CHECK that every row has exactly one of the two.
 *
 * There is deliberately NO email column and NO V Auth subject column. Both
 * already exist exactly once in better-auth's tables, for moderators only.
 */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Hex sha256 of the SPKI public key. The key itself is never stored.
    keyHash: text("key_hash").unique(),
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
