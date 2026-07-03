const SSH_INPUT_PREFIX = '{"type":"ssh:input","sessionId":"';
const SSH_INPUT_MIDDLE = '","payload":{"data":"';
const SSH_INPUT_SUFFIX = '"}}';
const JSON_ESCAPE_PATTERN = /[\\"\u0000-\u001f]/;

export type ParsedSshInputMessage = {
    sessionId: string;
    data: string;
};

const encodeJsonStringFastPath = (value: string): string => {
    if (!JSON_ESCAPE_PATTERN.test(value)) return value;

    return JSON.stringify(value).slice(1, -1);
};

export const buildSshInputDataPrefix = (sessionId: string): string =>
    `${SSH_INPUT_PREFIX}${encodeJsonStringFastPath(sessionId)}${SSH_INPUT_MIDDLE}`;

function decodeJsonStringFastPath(value: string): string | null {
    if (!JSON_ESCAPE_PATTERN.test(value)) return value;

    let decoded = '';
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (char !== '\\') {
            if (char === '"' || char < ' ') return null;
            decoded += char;
            continue;
        }

        i += 1;
        if (i >= value.length) return null;

        const escaped = value[i];
        switch (escaped) {
            case '"':
            case '\\':
            case '/':
                decoded += escaped;
                break;
            case 'b':
                decoded += '\b';
                break;
            case 'f':
                decoded += '\f';
                break;
            case 'n':
                decoded += '\n';
                break;
            case 'r':
                decoded += '\r';
                break;
            case 't':
                decoded += '\t';
                break;
            case 'u': {
                const hex = value.slice(i + 1, i + 5);
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
                decoded += String.fromCharCode(Number.parseInt(hex, 16));
                i += 4;
                break;
            }
            default:
                return null;
        }
    }

    return decoded;
}

export function parseSshInputFastPath(messageText: string): ParsedSshInputMessage | null;
export function parseSshInputFastPath(messageText: string, expectedDataPrefix: string): string | null;
export function parseSshInputFastPath(messageText: string, expectedDataPrefix?: string): ParsedSshInputMessage | string | null {
    if (!messageText.endsWith(SSH_INPUT_SUFFIX)) {
        return null;
    }

    if (expectedDataPrefix !== undefined) {
        if (!messageText.startsWith(expectedDataPrefix)) return null;
        const rawData = messageText.slice(expectedDataPrefix.length, -SSH_INPUT_SUFFIX.length);
        return decodeJsonStringFastPath(rawData);
    }

    if (!messageText.startsWith(SSH_INPUT_PREFIX)) {
        return null;
    }

    const middleIndex = messageText.indexOf(SSH_INPUT_MIDDLE, SSH_INPUT_PREFIX.length);
    if (middleIndex < 0) return null;

    const rawSessionId = messageText.slice(SSH_INPUT_PREFIX.length, middleIndex);
    const rawData = messageText.slice(middleIndex + SSH_INPUT_MIDDLE.length, -SSH_INPUT_SUFFIX.length);
    const sessionId = decodeJsonStringFastPath(rawSessionId);
    const data = decodeJsonStringFastPath(rawData);

    if (sessionId === null || data === null) return null;
    return { sessionId, data };
}
