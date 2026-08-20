/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@kal-el/design-system", "@kal-el/editor", "@kal-el/contracts"],
  reactStrictMode: true,
  /**
   * Standalone output traces exactly the files the server needs into one directory, so
   * the runtime image does not have to carry the whole pnpm workspace - every dev
   * dependency of every package, including the embedded PostgreSQL the test kit pulls in.
   *
   * Opt-in rather than always on, because the trace step recreates pnpm's symlink farm
   * and creating symlinks on Windows requires Developer Mode or elevation. Leaving it on
   * unconditionally makes `pnpm build` fail on a developer machine for a reason that has
   * nothing to do with the code. The Dockerfile sets NEXT_OUTPUT=standalone; everywhere
   * else `next start` serves the ordinary build.
   */
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? {
        output: "standalone",
        // The workspace root, not apps/cms: the trace has to reach the linked workspace
        // packages, which live outside this app's directory.
        outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
      }
    : {}),
  /**
   * `.next` has exactly one owner. `next dev`, `next build` and `next start` all read and
   * write the same directory, so a build started while a dev server is up deletes the
   * chunks under it: the server first answers `Cannot find module './594.js'`, then stops
   * answering at all. Every request after that point fails with ERR_CONNECTION_REFUSED,
   * which in a test run looks exactly like a product regression rather than two processes
   * sharing a directory.
   *
   * Set NEXT_DIST_DIR to give a run its own build directory. The e2e suite is the case
   * that needs it - it starts a dev server while someone may well be building or serving
   * the same app - but nothing here is specific to tests.
   */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
