import { Router, Request, Response } from 'express';

const router = Router();
const GITHUB_REPO = 'spfantop/fantetic-terminal';
const VERSION_FILE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/VERSION`;
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

router.get('/remote', async (_req: Request, res: Response) => {
  const cached = readCached('remote');
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const response = await fetch(VERSION_FILE_URL, { headers: { Accept: 'text/plain' } });
    if (!response.ok) {
      res.status(502).json({ version: null, error: 'fetch_failed' });
      return;
    }

    const result = { version: (await response.text()).trim() };
    writeCached('remote', result);
    res.json(result);
  } catch (error) {
    console.warn('[Version] 远程 VERSION 文件请求失败:', error);
    res.status(502).json({ version: null, error: 'fetch_failed' });
  }
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
