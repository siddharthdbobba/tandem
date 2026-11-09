// Shared helpers for tests: sign up / sign in real accounts through Convex Auth.
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export const api = anyApi;
export const URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns an authenticated ConvexHttpClient for a fresh or existing account.
export async function account(email, password = "test-password-123", name, flow = "signUp", invite = process.env.TANDEM_INVITE) {
  const c = new ConvexHttpClient(URL);
  const r = await c.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow, ...(name ? { name } : {}), ...(flow === "signUp" && invite ? { invite } : {}) },
  });
  if (!r?.tokens?.token) throw new Error(`${flow} failed for ${email}`);
  c.setAuth(r.tokens.token);
  c.token = r.tokens.token;
  await c.mutation(api.profile.init, {});
  return c;
}

export const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function until(fn, ms = 30000, label = "condition", every = 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  throw new Error(`timeout: ${label}`);
}
