import { ensureTestPostgres, stopTestPostgres } from "@kal-el/testkit";

export default async function setup() {
  await ensureTestPostgres();
}

export async function teardown() {
  await stopTestPostgres();
  // The embedded postgres child keeps the event loop alive; exit explicitly
  // to avoid vitest's 10s "close timed out" wait.
  const code = process.exitCode ?? 0;
  setTimeout(() => process.exit(code), 0);
}
