import { query } from "./_generated/server";

// Which sign-in methods are configured, so the UI only shows working buttons.
export const methods = query({
  args: {},
  handler: async () => ({
    github: !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  }),
});
