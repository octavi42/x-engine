import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export async function fetch(source) {
  const {
    dbPath = '~/.northstar/northstar.sqlite',
    runsToScan = 5,
    minScore = 75,
    maxIdeas = 10,
  } = source.params ?? {};

  const absDb = expandHome(dbPath);

  if (!existsSync(absDb)) {
    return {
      items: [],
      meta: {
        db_path: absDb,
        note: 'northstar DB not found — local-only source, expected in CI',
      },
    };
  }

  // Pulls top-scored, non-rejected ideas from the most recent N completed
  // runs. Joins runs for context (goal + niche). sqlite3 -json gives us a
  // structured array we can parse directly.
  //
  // Why CLI not better-sqlite3: avoids a native build dep for a source that
  // only runs locally anyway. macOS ships sqlite3 by default; Linux runners
  // have it too.
  const query = `
    WITH recent_runs AS (
      SELECT id, goal, niche, completed_at
      FROM runs
      WHERE status = 'completed'
      ORDER BY id DESC
      LIMIT ${Number(runsToScan)}
    )
    SELECT
      i.id, i.run_id, i.name, i.pitch, i.score, i.scores,
      i.critique, i.build_path, i.next_action,
      i.created_at,
      rr.goal AS run_goal,
      rr.niche AS run_niche,
      rr.completed_at AS run_completed_at
    FROM ideas i
    JOIN recent_runs rr ON i.run_id = rr.id
    WHERE i.rejected = 0
      AND i.score >= ${Number(minScore)}
    ORDER BY i.score DESC, i.id DESC
    LIMIT ${Number(maxIdeas)};
  `;

  let rows;
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', absDb, query], {
      maxBuffer: 4 * 1024 * 1024,
    });
    rows = stdout.trim() ? JSON.parse(stdout) : [];
  } catch (err) {
    return {
      items: [],
      meta: { db_path: absDb, error: `sqlite3 query failed: ${err.message}` },
    };
  }

  const items = rows.map((row) => {
    const scoresParsed = safeJson(row.scores) ?? {};
    const scoreBreakdown = Object.entries(scoresParsed)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    const body = [
      `**Score:** ${row.score}${scoreBreakdown ? ` (${scoreBreakdown})` : ''}`,
      '',
      `**Pitch:** ${row.pitch ?? '(no pitch)'}`,
      row.critique ? '' : null,
      row.critique ? `**Critique:** ${truncate(row.critique, 600)}` : null,
      row.next_action ? '' : null,
      row.next_action ? `**Next action:** ${truncate(row.next_action, 400)}` : null,
      '',
      `_run ${row.run_id} · niche: ${row.run_niche ?? 'unknown'}_`,
    ]
      .filter((l) => l !== null)
      .join('\n');

    return {
      title: `${row.name} (run ${row.run_id} · score ${row.score})`,
      body,
      tags: ['northstar', `run-${row.run_id}`, `score-${row.score}`],
    };
  });

  return {
    items,
    meta: {
      db_path: absDb,
      runs_scanned: Number(runsToScan),
      min_score: Number(minScore),
      ideas_returned: items.length,
    },
  };
}

function expandHome(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  // Absolute paths pass through; relative paths resolve against CWD at call
  // time. The shipped config sets an absolute-after-expansion path, so this
  // branch is rarely exercised — but if a fork uses a relative dbPath, it
  // resolves predictably.
  return resolve(p);
}

function safeJson(s) {
  if (typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
