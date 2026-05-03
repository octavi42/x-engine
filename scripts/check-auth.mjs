#!/usr/bin/env node
import { TwitterApi } from "twitter-api-v2";

function need(name) {
  if (!process.env[name]) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

const client = new TwitterApi({
  appKey: need("X_API_KEY"),
  appSecret: need("X_API_SECRET"),
  accessToken: need("X_ACCESS_TOKEN"),
  accessSecret: need("X_ACCESS_SECRET"),
});

let v1ok = false, v2ok = false;

try {
  const v1me = await client.v1.verifyCredentials();
  console.log(`v1.1 ok: @${v1me.screen_name} (id: ${v1me.id_str})`);
  v1ok = true;
} catch (e) {
  console.error(`v1.1 failed: ${e.code ?? ""} ${e.message}`);
  if (e.data) console.error("  " + JSON.stringify(e.data));
}

try {
  const v2me = await client.v2.me();
  console.log(`v2 ok: @${v2me.data.username} (id: ${v2me.data.id})`);
  v2ok = true;
} catch (e) {
  console.error(`v2 failed: ${e.code ?? ""} ${e.message}`);
  if (e.data) console.error("  " + JSON.stringify(e.data));
}

console.log("");
if (v1ok && v2ok) console.log("DIAGNOSIS: keys are valid and v2 enrollment is good — ready to post.");
else if (v1ok && !v2ok) console.log("DIAGNOSIS: keys are valid; v2 endpoint is blocked. Project enrollment / Free-tier signup needed.");
else if (!v1ok && v2ok) console.log("DIAGNOSIS: weird state — v2 works but v1.1 doesn't. Probably fine for posting.");
else console.log("DIAGNOSIS: keys themselves are rejected. Likely wrong app or bad permissions.");

process.exit(v2ok ? 0 : 1);
