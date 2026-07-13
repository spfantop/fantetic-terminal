const ELECTRON_NONCE_HEADER = 'X-Fantetic-Electron-Nonce';
const ELECTRON_BACKEND_ORIGIN = 'http://localhost:22458';

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch (_error) {
    return null;
  }
};

const isTrustedRendererUrl = (candidateUrl, frontendUrl) => {
  const candidate = parseUrl(candidateUrl);
  const frontend = parseUrl(frontendUrl);
  return Boolean(
    candidate
    && frontend
    && candidate.protocol === 'http:'
    && candidate.origin === frontend.origin,
  );
};

const isAllowedPopupUrl = (candidateUrl, frontendUrl) => (
  candidateUrl === '' || candidateUrl === 'about:blank' || isTrustedRendererUrl(candidateUrl, frontendUrl)
);

const isElectronBackendRequest = (requestUrl) => {
  const candidate = parseUrl(requestUrl);
  return Boolean(
    candidate
    && (candidate.protocol === 'http:' || candidate.protocol === 'ws:')
    && `${candidate.protocol === 'ws:' ? 'http:' : candidate.protocol}//${candidate.host}` === ELECTRON_BACKEND_ORIGIN,
  );
};

const addElectronNonceHeader = (details, nonce) => {
  const requestHeaders = { ...(details.requestHeaders || {}) };
  if (!nonce || !isElectronBackendRequest(details.url)) return requestHeaders;

  Object.keys(requestHeaders).forEach((name) => {
    if (name.toLowerCase() === ELECTRON_NONCE_HEADER.toLowerCase()) {
      delete requestHeaders[name];
    }
  });
  requestHeaders[ELECTRON_NONCE_HEADER] = nonce;
  return requestHeaders;
};

module.exports = {
  ELECTRON_NONCE_HEADER,
  addElectronNonceHeader,
  isAllowedPopupUrl,
  isTrustedRendererUrl,
};
