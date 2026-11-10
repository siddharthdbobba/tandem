import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import GitHub from "@auth/core/providers/github";
import { ConvexError } from "convex/values";

// GitHub sign-in is enabled when AUTH_GITHUB_ID / AUTH_GITHUB_SECRET are set
// on the deployment. OAuth callback URL to register on the GitHub app:
//   <CONVEX_SITE_URL>/api/auth/callback/github
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      profile(gh) {
        return {
          id: String(gh.id),
          name: (gh.name || gh.login || "GitHub user").slice(0, 40),
          email: gh.email ?? undefined,
          image: gh.avatar_url,
        };
      },
    }),
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
