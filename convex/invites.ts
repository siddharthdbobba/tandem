// Signup invite codes. Admin-only (internal functions, run from the CLI):
//   npx convex run invites:create '{"maxUses": 5, "note": "friends"}'
//   npx convex run invites:list
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { randomCode } from "./lib";

export const create = internalMutation({
  args: { maxUses: v.optional(v.number()), days: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, { maxUses, days, note }) => {
    const code = randomCode(10);
    await ctx.db.insert("signupInvites", {
      code,
      uses: 0,
      maxUses: maxUses ?? 1,
      expiresAt: days ? Date.now() + days * 86_400_000 : undefined,
      note,
    });
    return code;
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("signupInvites").collect()).map((i) => ({
      code: i.code,
      uses: `${i.uses}/${i.maxUses}`,
      expires: i.expiresAt ? new Date(i.expiresAt).toISOString() : "never",
      note: i.note ?? "",
    })),
});
