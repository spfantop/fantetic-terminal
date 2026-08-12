const TERMINAL_BACKGROUND_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const BACKGROUND_DOCUMENT_STYLES = [
  'html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }',
  'body > * { max-width: 100%; }',
].join(' ');

export const buildTerminalBackgroundDocument = (htmlContent: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${TERMINAL_BACKGROUND_CSP}">
    <style>${BACKGROUND_DOCUMENT_STYLES}</style>
  </head>
  <body>${htmlContent}</body>
</html>`;
