/**
 * Minimal GitHub "contents" API client. Talks only to api.github.com with a
 * fine-grained token limited to one private repository.
 */
export interface RepoTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const API = 'https://api.github.com';

function headers(t: RepoTarget, accept = 'application/vnd.github+json'): HeadersInit {
  return { Authorization: `Bearer ${t.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

const contentsUrl = (t: RepoTarget) => `${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/contents/${t.path.split('/').map(encodeURIComponent).join('/')}`;

async function explain(res: Response): Promise<GitHubError> {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* ignore */
  }
  if (res.status === 401) return new GitHubError('GitHub rejected the access token. It may have expired — create a new one.', 401);
  if (res.status === 403) return new GitHubError(`GitHub refused access${detail ? `: ${detail}` : ''}. Check the token has “Contents: read and write” for this repository.`, 403);
  if (res.status === 404) return new GitHubError('Repository not found, or the token cannot see it.', 404);
  return new GitHubError(`GitHub error ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
}

export async function checkRepo(t: RepoTarget, f: typeof fetch = fetch): Promise<{ private: boolean; canPush: boolean }> {
  const res = await f(`${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`, { headers: headers(t), cache: 'no-store' });
  if (!res.ok) throw await explain(res);
  const j = (await res.json()) as { private: boolean; permissions?: { push?: boolean } };
  return { private: j.private, canPush: j.permissions?.push ?? true };
}

export async function readFile(t: RepoTarget, f: typeof fetch = fetch): Promise<{ text: string; sha: string } | null> {
  const url = `${contentsUrl(t)}?ref=${encodeURIComponent(t.branch)}`;
  const res = await f(url, { headers: headers(t), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw await explain(res);
  const j = (await res.json()) as { sha: string; content?: string; encoding?: string; size: number };
  if (j.content && j.encoding === 'base64') {
    const bin = atob(j.content.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { text: new TextDecoder().decode(bytes), sha: j.sha };
  }
  // Files over 1 MB come without inline content: fetch the raw bytes.
  const raw = await f(url, { headers: headers(t, 'application/vnd.github.raw+json'), cache: 'no-store' });
  if (!raw.ok) throw await explain(raw);
  return { text: await raw.text(), sha: j.sha };
}

/** Returns the new sha. Throws GitHubError(409) if someone else wrote first. */
export async function writeFile(t: RepoTarget, text: string, sha: string | undefined, message: string, f: typeof fetch = fetch): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = await f(contentsUrl(t), {
    method: 'PUT',
    headers: { ...headers(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: btoa(bin), branch: t.branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) throw new GitHubError('The shared file changed on the other phone.', 409);
  if (!res.ok) throw await explain(res);
  return ((await res.json()) as { content: { sha: string } }).content.sha;
}
