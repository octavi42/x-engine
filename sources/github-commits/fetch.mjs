import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const REPO_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[\s)\/]|$)/;

export async function fetch(source) {
  const {
    projectsDir = 'config/projects',
    sinceDays = 7,
    maxPerRepo = 20,
  } = source.params ?? {};

  const repoRoot = resolve(source.dir, '..', '..');
  const absProjectsDir = isAbsolute(projectsDir) ? projectsDir : resolve(repoRoot, projectsDir);

  const projects = await discoverProjects(absProjectsDir);
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  const items = [];
  const errors = [];
  const skipped = [];

  for (const project of projects) {
    if (!project.repo) {
      skipped.push(`${project.name} (no GitHub URL)`);
      continue;
    }
    const { owner, repo } = project.repo;
    try {
      const commits = await fetchCommits(owner, repo, since, maxPerRepo);
      for (const commit of commits) {
        const message = commit.commit?.message ?? '';
        const [subject, ...rest] = message.split('\n');
        const sha = commit.sha?.slice(0, 7) ?? '';
        items.push({
          title: `${repo}: ${subject}`,
          body: [
            `**${commit.commit?.author?.name ?? 'unknown'}** · ${commit.commit?.author?.date ?? ''} · ${sha}`,
            '',
            message.trim(),
          ].join('\n'),
          url: commit.html_url,
          tags: [project.name, `${owner}/${repo}`, sha].filter(Boolean),
        });
      }
    } catch (err) {
      errors.push(`${owner}/${repo}: ${err.message}`);
    }
  }

  items.sort((a, b) => (b.url ?? '').localeCompare(a.url ?? ''));

  const meta = {
    since,
    projects_scanned: projects.length,
    repos_with_commits: new Set(items.flatMap((i) => i.tags?.filter((t) => t.includes('/')) ?? [])).size,
  };
  if (skipped.length) meta.skipped = skipped.join(', ');
  if (errors.length) meta.errors = errors.join(' | ');
  return { items, meta };
}

async function discoverProjects(dir) {
  const files = (await readdir(dir)).filter((f) => extname(f) === '.md').sort();
  const projects = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    const match = text.match(REPO_RE);
    projects.push({
      name: basename(file, '.md'),
      repo: match ? { owner: match[1], repo: match[2] } : null,
    });
  }
  return projects;
}

async function fetchCommits(owner, repo, since, perPage) {
  const path = `repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=${perPage}`;
  const { stdout } = await execFileAsync('gh', ['api', path], { maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
