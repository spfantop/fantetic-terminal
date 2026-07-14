const http = require('node:http');

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const requestHttp = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, { timeout: 2_000 }, (response) => {
    response.resume();
    response.on('end', () => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
        resolve();
        return;
      }

      reject(new Error(`HTTP ${response.statusCode}`));
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error(`Timed out waiting for ${url}`));
  });
  request.on('error', reject);
});

const waitForHttp = async (url, {
  label = url,
  timeoutMs = 60_000,
  intervalMs = 500,
} = {}) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await requestHttp(url);
      return;
    } catch (error) {
      lastError = error;
      await wait(intervalMs);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : 'timeout';
  throw new Error(`${label} was not ready at ${url}: ${reason}`);
};

module.exports = {
  requestHttp,
  waitForHttp,
};
