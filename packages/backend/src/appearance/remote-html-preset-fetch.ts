export const REMOTE_HTML_PRESET_MAX_BYTES = 10 * 1024;

interface RemoteHtmlPresetResponse {
  status: number;
  data: unknown;
}

interface RemoteHtmlPresetRequestConfig {
  responseType: 'text';
  maxRedirects: 0;
  maxContentLength: number;
  timeout: number;
}

export type RemoteHtmlPresetHttpGet = (
  url: string,
  config: RemoteHtmlPresetRequestConfig,
) => Promise<RemoteHtmlPresetResponse>;

export const parseRemoteHtmlPresetUrl = (fileUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new Error('无效的远程 HTML 主题 URL。');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'raw.githubusercontent.com'
    || parsed.port
    || parsed.username
    || parsed.password
    || !parsed.pathname.toLowerCase().endsWith('.html')
  ) {
    throw new Error('远程 HTML 主题 URL 必须是 raw.githubusercontent.com 的 HTTPS HTML 文件。');
  }

  return parsed;
};

export const fetchRemoteHtmlPreset = async (
  fileUrl: string,
  httpGet: RemoteHtmlPresetHttpGet,
): Promise<string> => {
  const parsed = parseRemoteHtmlPresetUrl(fileUrl);
  const response = await httpGet(parsed.href, {
    responseType: 'text',
    maxRedirects: 0,
    maxContentLength: REMOTE_HTML_PRESET_MAX_BYTES,
    timeout: 10_000,
  });

  if (response.status !== 200 || typeof response.data !== 'string') {
    throw new Error(`无法从远程 URL 获取 HTML 主题内容。状态: ${response.status}`);
  }
  if (Buffer.byteLength(response.data, 'utf8') > REMOTE_HTML_PRESET_MAX_BYTES) {
    throw new Error(`远程 HTML 主题内容不得超过 ${REMOTE_HTML_PRESET_MAX_BYTES} 字节。`);
  }

  return response.data;
};
