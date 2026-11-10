/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as authInfo from "../authInfo.js";
import type * as changes from "../changes.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as maintenance from "../maintenance.js";
import type * as presence from "../presence.js";
import type * as profile from "../profile.js";
import type * as templates from "../templates.js";
import type * as worker from "../worker.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  authInfo: typeof authInfo;
  changes: typeof changes;
  chat: typeof chat;
  crons: typeof crons;
  files: typeof files;
  http: typeof http;
  lib: typeof lib;
  maintenance: typeof maintenance;
  presence: typeof presence;
  profile: typeof profile;
  templates: typeof templates;
  worker: typeof worker;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
