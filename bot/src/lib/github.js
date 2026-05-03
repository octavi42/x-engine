const GH = "https://api.github.com";

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function headers(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "x-engine-bot",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function getFile(env, repo, path, ref = "main") {
  const url = `${GH}/repos/${repo}/contents/${encodeURI(path)}?ref=${ref}`;
  const res = await fetch(url, { headers: headers(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github get ${path}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { content: b64decode(json.content), sha: json.sha };
}

export async function putFile(env, repo, path, content, message, sha) {
  const url = `${GH}/repos/${repo}/contents/${encodeURI(path)}`;
  const body = { message, content: b64encode(content), branch: "main" };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`github put ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
