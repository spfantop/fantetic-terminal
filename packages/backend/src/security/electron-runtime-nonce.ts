import { createHmac, timingSafeEqual } from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';

export const ELECTRON_RUNTIME_NONCE_HEADER = 'x-fantetic-electron-nonce';
export const ELECTRON_READINESS_CHALLENGE_HEADER = 'x-fantetic-readiness-challenge';
export const ELECTRON_READINESS_PROOF_HEADER = 'x-fantetic-readiness-proof';

const readHeader = (headers: IncomingHttpHeaders, name: string): string | undefined => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
};

export const isElectronRuntimeNonceValid = (
    headers: IncomingHttpHeaders,
    expectedNonce = process.env.FANTETIC_ELECTRON_NONCE,
): boolean => {
    const receivedNonce = readHeader(headers, ELECTRON_RUNTIME_NONCE_HEADER);
    if (!expectedNonce || !receivedNonce) return false;

    const expectedBuffer = Buffer.from(expectedNonce);
    const receivedBuffer = Buffer.from(receivedNonce);
    return expectedBuffer.length === receivedBuffer.length
        && timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const createElectronRuntimeReadinessProof = (
    headers: IncomingHttpHeaders,
    runtimeNonce = process.env.FANTETIC_ELECTRON_NONCE,
): string | undefined => {
    const challenge = readHeader(headers, ELECTRON_READINESS_CHALLENGE_HEADER);
    if (!runtimeNonce || !challenge || !/^[a-f0-9]{64}$/i.test(challenge)) return undefined;

    return createHmac('sha256', runtimeNonce).update(challenge).digest('hex');
};
