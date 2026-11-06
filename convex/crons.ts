import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cancel orphaned runs", { minutes: 5 }, internal.maintenance.cleanupOrphans);
export default crons;
