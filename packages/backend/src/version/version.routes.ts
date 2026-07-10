import { Router, Request, Response } from 'express';

const router = Router();
const GITHUB_REPO = 'spfantop/fantetic-terminal';
const PACKAGE_JSON_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { timestamp: number; data: unknown }>();

const readCached = (key: string) => {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

const writeCached = (key: string, data: unknown) => {
  cache.set(key, { timestamp: Date.now(), data });
};

const normalizeRemoteVersion = (version: unknown): string | null => {
  if (typeof version !== 'string') return null;
  const normalized = version.trim();
  return normalized.length > 0 ? normalized : null;
};

const readLatestReleaseVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      console.warn(`[Version] GitHub releases 请求失败，状态码: ${response.status}`);
      return null;
    }

    const data = await response.json() as { tag_name?: string };
    return normalizeRemoteVersion(data.tag_name);
  } catch (error) {
    console.warn('[Version] GitHub releases 请求失败:', error);
    return null;
  }
};

const readPackageVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(PACKAGE_JSON_URL, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (!response.ok) {
      console.warn(`[Version] 远程 package.json 请求失败，状态码: ${response.status}`);
      return null;
    }

    const data = await response.json() as { version?: unknown };
    return normalizeRemoteVersion(data.version);
  } catch (error) {
    console.warn('[Version] 远程 package.json 请求失败:', error);
    return null;
  }
};

router.get('/remote', async (_req: Request, res: Response) => {
  const cached = readCached('remote');
  if (cached) {
    res.json(cached);
    return;
  }

  const releaseVersion = await readLatestReleaseVersion();
  if (releaseVersion) {
    const result = { version: releaseVersion, source: 'release' };
    writeCached('remote', result);
    res.json(result);
    return;
  }

  const packageVersion = await readPackageVersion();
  if (packageVersion) {
    const result = { version: packageVersion, source: 'package_metadata' };
    writeCached('remote', result);
    res.json(result);
    return;
  }

  res.status(502).json({ version: null, error: 'fetch_failed' });
});

router.get('/latest', async (_req: Request, res: Response) => {
  const cached = readCached('latest');
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (response.status === 404) {
      res.json({ tag: null, htmlUrl: null, error: 'no_release' });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ tag: null, htmlUrl: null, error: 'fetch_failed' });
      return;
    }

    const data = await response.json() as { tag_name?: string; html_url?: string };
    const result = { tag: data.tag_name ?? null, htmlUrl: data.html_url ?? null };
    writeCached('latest', result);
    res.json(result);
  } catch (error) {
    console.warn('[Version] GitHub releases 请求失败:', error);
    res.status(502).json({ tag: null, htmlUrl: null, error: 'fetch_failed' });
  }
});

export default router;
