import { ensureTestPostgres, stopTestPostgres } from "@kal-el/testkit";

export default async function setup() {
  await ensureTestPostgres();
}

export async function teardown() {
  await stopTestPostgres();
  const code = process.exitCode ?? 0;
  setTimeout(() => process.exit(code), 0);
}
