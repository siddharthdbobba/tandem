import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";

// Signups are invite-only: running an agent means running code on the host VM.
// New accounts must present an unused code from the signupInvites table
// (mint with `npx convex run invites:create`). Workspace invite links count too,
// so a member can bring a friend into a workspace without a separate code.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: String(params.email).trim().toLowerCase(),
          name: String(params.name ?? params.email).trim().slice(0, 40),
          invite: String(params.invite ?? "").trim(),
        };
      },
      validatePasswordRequirements(password) {
        if (password.length < 8) throw new ConvexError("Password must be at least 8 characters");
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(rawCtx, { existingUserId, profile }) {
      if (existingUserId) return existingUserId;
      const ctx = rawCtx as unknown as MutationCtx;
      const code = String(profile.invite ?? "");
      const now = Date.now();
      const invite = code
        ? await ctx.db
            .query("signupInvites")
            .withIndex("by_code", (q) => q.eq("code", code))
            .unique()
        : null;
      const workspace = !invite && code
        ? await ctx.db
            .query("workspaces")
            .withIndex("by_invite", (q) => q.eq("inviteCode", code))
            .unique()
        : null;
      const usable = invite && invite.uses < invite.maxUses && (!invite.expiresAt || invite.expiresAt > now);
      if (!usable && !workspace) throw new ConvexError("An invite code is required to sign up.");
      if (invite) await ctx.db.patch(invite._id, { uses: invite.uses + 1 });
      return ctx.db.insert("users", {
        email: profile.email as string,
        name: profile.name as string,
      });
    },
  },
});
