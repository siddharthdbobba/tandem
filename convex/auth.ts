import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: String(params.email).trim().toLowerCase(),
          name: String(params.name ?? params.email).trim().slice(0, 40),
        };
      },
      validatePasswordRequirements(password) {
        if (password.length < 8) throw new ConvexError("Password must be at least 8 characters");
      },
    }),
  ],
});
