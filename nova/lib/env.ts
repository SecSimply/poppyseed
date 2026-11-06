/**
 * What the process knows about where it runs: its public address and its secret. In development and at build time
 * there are defaults; in production there are none, so a missing variable stops the server rather than running with a
 * known secret.
 */
export const isDev = process.env.NODE_ENV !== "production";
export const isBuild = process.env.NEXT_PHASE === "phase-production-build";

const given = process.env.POPPYSEED_BASE_URL ?? (isDev || isBuild ? "http://localhost:3000" : undefined);
if (!given) throw new Error("Set POPPYSEED_BASE_URL to the public origin in production");
export const baseUrl: string = given;

const secretGiven = process.env.POPPYSEED_SECRET ?? (isDev || isBuild ? "dev-only-secret-change-me-in-production!!" : undefined);
if (!secretGiven) throw new Error("Set POPPYSEED_SECRET (32+ characters) in production");
export const secret: string = secretGiven;

/** An https site gets `__Host-` cookies, which need Secure. A local http site cannot set those. */
export const secure = baseUrl.startsWith("https://");
