import { relations } from "drizzle-orm";

import { user, session, account } from "./auth";
import { members } from "./members";
import { reports } from "./reports";
import { moderationAudit } from "./audit";

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  member: one(members, { fields: [user.id], references: [members.userId] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  // Moderators only (VRIP-13). Nothing traverses it to show a person.
  user: one(user, { fields: [members.userId], references: [user.id] }),
  reportsFiled: many(reports, { relationName: "reporter" }),
  reportsAgainst: many(reports, { relationName: "reported" }),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  reporter: one(members, {
    fields: [reports.reporterMemberId],
    references: [members.id],
    relationName: "reporter",
  }),
  reported: one(members, {
    fields: [reports.reportedMemberId],
    references: [members.id],
    relationName: "reported",
  }),
  audit: many(moderationAudit),
}));

export const moderationAuditRelations = relations(
  moderationAudit,
  ({ one }) => ({
    actor: one(members, {
      fields: [moderationAudit.actorMemberId],
      references: [members.id],
    }),
    report: one(reports, {
      fields: [moderationAudit.reportId],
      references: [reports.id],
    }),
  }),
);
