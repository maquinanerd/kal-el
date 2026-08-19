/**
 * One-time provisioning: create the first site and its owner.
 *
 * Wraps `POST /v1/bootstrap/init` so an operator does not have to hand-assemble a curl
 * with a header and a nested JSON body at the one moment when getting it wrong is most
 * expensive. It talks to the running API over HTTP rather than to the database, so the
 * advisory lock, the already-initialized check and the audit entry all apply exactly as
 * they do for any other caller.
 *
 * Usage:
 *   API_BASE_URL=... BOOTSTRAP_TOKEN=... pnpm bootstrap \
 *     --site-slug portal --site-name "Portal" \
 *     --email owner@example.com --name "Owner" [--password ...]
 *
 * The password may be supplied on the command line or in KALEL_OWNER_PASSWORD. Prefer the
 * environment variable: an argument is visible in the process list and in shell history.
 */

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args["api"] ?? process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const token = process.env.BOOTSTRAP_TOKEN ?? args["token"];
  const password = process.env.KALEL_OWNER_PASSWORD ?? args["password"];

  if (!token) fail("BOOTSTRAP_TOKEN is required (env, or --token)");
  if (!password) fail("owner password is required (KALEL_OWNER_PASSWORD, or --password)");

  const missing = ["site-slug", "site-name", "email", "name"].filter((k) => !args[k]);
  if (missing.length > 0) fail(`missing required argument(s): ${missing.map((m) => `--${m}`).join(", ")}`);

  const res = await fetch(`${baseUrl}/v1/bootstrap/init`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bootstrap-token": token },
    body: JSON.stringify({
      site: { slug: args["site-slug"], name: args["site-name"] },
      user: { email: args["email"], name: args["name"], password },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    // The endpoint answers identically for a wrong token and an already-provisioned
    // system - that is deliberate, so it cannot be used to confirm a guessed token. The
    // server log distinguishes them for whoever is running this.
    console.error(`bootstrap refused (HTTP ${res.status}): ${text}`);
    console.error("check the API log for the reason: a wrong token and an already-initialized system answer the same way");
    process.exit(1);
  }

  const body = JSON.parse(text) as { data: { site: { id: string; slug: string }; user: { id: string; email: string } } };
  console.log(`site   ${body.data.site.slug} (${body.data.site.id})`);
  console.log(`owner  ${body.data.user.email} (${body.data.user.id})`);
  console.log("remove BOOTSTRAP_TOKEN from the environment now - it has done its only job");
}

void main();
