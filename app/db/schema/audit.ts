import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

import { members } from "./members";
import { reports } from "./reports";

/**
 * Append-only. Every moderator action lands here, from either front door.
 *
 * `reportId` is the binding VRIP-04 requires. The CHECK constraint that makes
 * it structural — a `reveal` row with a null `report_id` is rejected — lives in
 * migrations/0001, because drizzle-kit push does not carry table CHECKs
 * reliably and this one must not be optional.
 */
export const moderationAudit = pgTable(
  "moderation_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    // No FK cascade to a deleted member: an audit trail whose rows vanish with
    // the account is not an audit trail.
    actorMemberId: uuid("actor_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    // console | script (VRIP-08)
    actorKind: text("actor_kind").notNull(),
    // member | message | report | room
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reportId: uuid("report_id").references(() => reports.id, {
      onDelete: "set null",
    }),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("moderation_audit_action_idx").on(t.action),
    index("moderation_audit_actor_idx").on(t.actorMemberId),
    index("moderation_audit_target_idx").on(t.targetType, t.targetId),
    index("moderation_audit_created_at_idx").on(t.createdAt),
  ],
);

export const AUDIT_ACTIONS = [
  "reveal",
  "delete_message",
  "suspend",
  // Written by the console when it mirrors an auto-suspension the room made on
  // its own (VRIP-09). The actor is null: no human decided it.
  "auto_suspend",
  "restore",
  "dismiss_report",
  "room_close",
  "room_open",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ACTOR_KINDS = ["console", "script"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export type AuditRow = typeof moderationAudit.$inferSelect;
