import "server-only";

// Thin wrapper over the two GitHub REST endpoints we need for the
// "push code to production" button:
//   - GET  /repos/:owner/:repo/compare/:base...:head  → how far ahead?
//   - POST /repos/:owner/:repo/merges                  → merge commit
//
// Endpoints documented at docs.github.com/en/rest. They've been stable
// since the v3 API and require no preview header. Auth is a fine-grained
// PAT scoped to Contents: read+write on the toto-mundial repo (see
// _plans/2026-05-29-sandbox-environment.md §3).

type GhEnv = {
  token: string;
  owner: string;
  repo: string;
};

export function readGithubEnv(): GhEnv {
  const token = process.env.GITHUB_DEPLOY_TOKEN;
  const owner = process.env.GITHUB_DEPLOY_OWNER;
  const repo = process.env.GITHUB_DEPLOY_REPO;
  if (!token) throw new Error("GITHUB_DEPLOY_TOKEN is not set");
  if (!owner) throw new Error("GITHUB_DEPLOY_OWNER is not set");
  if (!repo) throw new Error("GITHUB_DEPLOY_REPO is not set");
  return { token, owner, repo };
}

const API = "https://api.github.com";

function headers(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "toto-mundial-sandbox",
  };
}

export type CompareResult = {
  aheadBy: number;
  behindBy: number;
  baseSha: string;
  headSha: string;
  commits: { sha: string; message: string; author: string | null }[];
};

export async function compareBranches(
  env: GhEnv,
  base: string,
  head: string,
): Promise<CompareResult> {
  const res = await fetch(
    `${API}/repos/${env.owner}/${env.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    { headers: headers(env.token), cache: "no-store" },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub compare failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    ahead_by: number;
    behind_by: number;
    base_commit: { sha: string };
    merge_base_commit: { sha: string };
    commits: {
      sha: string;
      commit: {
        message: string;
        author: { name: string | null } | null;
      };
    }[];
  };
  return {
    aheadBy: json.ahead_by,
    behindBy: json.behind_by,
    baseSha: json.base_commit.sha,
    headSha: json.commits[json.commits.length - 1]?.sha ?? json.merge_base_commit.sha,
    commits: json.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0]!,
      author: c.commit.author?.name ?? null,
    })),
  };
}

export type MergeOutcome =
  | { kind: "merged"; sha: string }
  | { kind: "up-to-date" }
  | { kind: "conflict"; detail: string };

export async function mergeBranches(
  env: GhEnv,
  base: string,
  head: string,
  commitMessage: string,
): Promise<MergeOutcome> {
  const res = await fetch(`${API}/repos/${env.owner}/${env.repo}/merges`, {
    method: "POST",
    headers: { ...headers(env.token), "Content-Type": "application/json" },
    body: JSON.stringify({ base, head, commit_message: commitMessage }),
  });
  if (res.status === 201) {
    const json = (await res.json()) as { sha: string };
    return { kind: "merged", sha: json.sha };
  }
  if (res.status === 204) return { kind: "up-to-date" };
  if (res.status === 409) {
    const body = await res.text();
    return { kind: "conflict", detail: body.slice(0, 500) };
  }
  const body = await res.text();
  throw new Error(`GitHub merge failed (${res.status}): ${body.slice(0, 500)}`);
}
