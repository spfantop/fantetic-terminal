import { timingSafeEqual } from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';

export const ELECTRON_RUNTIME_NONCE_HEADER = 'x-fantetic-electron-nonce';

const readHeader = (headers: IncomingHttpHeaders): string | undefined => {
    const value = headers[ELECTRON_RUNTIME_NONCE_HEADER];
    return Array.isArray(value) ? value[0] : value;
};

export const isElectronRuntimeNonceValid = (
    headers: IncomingHttpHeaders,
    expectedNonce = process.env.FANTETIC_ELECTRON_NONCE,
): boolean => {
    const receivedNonce = readHeader(headers);
    if (!expectedNonce || !receivedNonce) return false;

    const expectedBuffer = Buffer.from(expectedNonce);
    const receivedBuffer = Buffer.from(receivedNonce);
    return expectedBuffer.length === receivedBuffer.length
        && timingSafeEqual(expectedBuffer, receivedBuffer);
};
