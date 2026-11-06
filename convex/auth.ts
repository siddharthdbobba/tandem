import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

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
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
      },
    }),
  ],
});
