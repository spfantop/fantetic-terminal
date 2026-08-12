const http = require('node:http');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const READINESS_CHALLENGE_HEADER = 'x-fantetic-readiness-challenge';
const READINESS_PROOF_HEADER = 'x-fantetic-readiness-proof';
const MAX_RESPONSE_BYTES = 16 * 1024;

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const requestHttp = (url, {
  headers,
  validateResponse = ({ statusCode }) => {
    if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode}`);
  },
} = {}) => new Promise((resolve, reject) => {
  const request = http.get(url, { headers, timeout: 2_000 }, (response) => {
    const chunkList = [];
    let responseBytes = 0;

    response.on('data', (chunk) => {
      responseBytes += chunk.length;
      if (responseBytes > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`));
        return;
      }
      chunkList.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      try {
        validateResponse({
          body: Buffer.concat(chunkList).toString('utf8'),
          headers: response.headers,
          statusCode: response.statusCode ?? 0,
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error(`Timed out waiting for ${url}`));
  });
  request.on('error', reject);
});

const createElectronBackendReadinessProbe = (runtimeNonce) => {
  const challenge = randomBytes(32).toString('hex');
  const expectedProof = createHmac('sha256', runtimeNonce).update(challenge).digest();

  return {
    headers: { [READINESS_CHALLENGE_HEADER]: challenge },
    validateResponse: ({ body, headers, statusCode }) => {
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error('Invalid readiness response body');
      }
      if (payload?.status !== 'ready') throw new Error('Backend status is not ready');

      const proof = headers[READINESS_PROOF_HEADER];
      const proofValue = Array.isArray(proof) ? proof[0] : proof;
      if (typeof proofValue !== 'string' || !/^[a-f0-9]{64}$/i.test(proofValue)) {
        throw new Error('Missing or invalid readiness proof');
      }

      const receivedProof = Buffer.from(proofValue, 'hex');
      if (!timingSafeEqual(expectedProof, receivedProof)) {
        throw new Error('Readiness proof did not match the spawned backend');
      }
    },
  };
};

const waitForHttp = async (url, {
  label = url,
  timeoutMs = 60_000,
  intervalMs = 500,
  isTargetAlive,
  ...requestOptions
} = {}) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    if (isTargetAlive && !isTargetAlive()) {
      throw new Error(`${label} process exited before becoming ready`);
    }

    try {
      await requestHttp(url, requestOptions);
      if (isTargetAlive && !isTargetAlive()) {
        throw new Error(`${label} process exited before becoming ready`);
      }
      return;
    } catch (error) {
      if (isTargetAlive && !isTargetAlive()) {
        throw new Error(`${label} process exited before becoming ready`);
      }
      lastError = error;
      await wait(intervalMs);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : 'timeout';
  throw new Error(`${label} was not ready at ${url}: ${reason}`);
};

module.exports = {
  createElectronBackendReadinessProbe,
  requestHttp,
  waitForHttp,
};
