import { TwitterApi } from "twitter-api-v2";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}. Add it to .env.local.`);
  return v;
}

let _client;
function client() {
  if (_client) return _client;
  _client = new TwitterApi({
    appKey: need("X_API_KEY"),
    appSecret: need("X_API_SECRET"),
    accessToken: need("X_ACCESS_TOKEN"),
    accessSecret: need("X_ACCESS_SECRET"),
  });
  return _client;
}

export async function tweet(text) {
  const { data } = await client().v2.tweet(text);
  return { id: data.id, url: `https://x.com/i/web/status/${data.id}` };
}
