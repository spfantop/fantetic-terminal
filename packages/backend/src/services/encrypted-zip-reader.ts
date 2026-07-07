import crypto from 'crypto';
import zlib from 'zlib';
import aes from 'aes-js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const WINZIP_AES_EXTRA_FIELD_ID = 0x9901;
const WINZIP_AES_METHOD = 99;
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATED = 8;
const AES_256_SALT_LENGTH = 16;
const AES_256_KEY_LENGTH = 32;
const AES_PASSWORD_VERIFIER_LENGTH = 2;
const AES_AUTH_CODE_LENGTH = 10;
const PBKDF2_ITERATIONS = 1000;

type CentralDirectoryEntry = {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  aesCompressionMethod?: number;
  aesStrength?: number;
};

type DerivedAesKeys = {
  aesKey: Buffer;
  hmacKey: Buffer;
  passwordVerifier: Buffer;
};

const readUInt16LE = (buffer: Buffer, offset: number) => buffer.readUInt16LE(offset);
const readUInt32LE = (buffer: Buffer, offset: number) => buffer.readUInt32LE(offset);

const findEndOfCentralDirectoryOffset = (zipBuffer: Buffer): number => {
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22);
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32LE(zipBuffer, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('无效的 ZIP 文件：未找到中央目录结束记录。');
};

const parseAesExtraField = (extra: Buffer): Pick<CentralDirectoryEntry, 'aesCompressionMethod' | 'aesStrength'> => {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const headerId = readUInt16LE(extra, offset);
    const dataSize = readUInt16LE(extra, offset + 2);
    const dataStart = offset + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extra.length) break;

    if (headerId === WINZIP_AES_EXTRA_FIELD_ID) {
      if (dataSize < 7) {
        throw new Error('无效的 ZIP AES 扩展字段。');
      }
      return {
        aesStrength: extra.readUInt8(dataStart + 4),
        aesCompressionMethod: readUInt16LE(extra, dataStart + 5),
      };
    }

    offset = dataEnd;
  }
  return {};
};

const parseCentralDirectoryEntries = (zipBuffer: Buffer): CentralDirectoryEntry[] => {
  const eocdOffset = findEndOfCentralDirectoryOffset(zipBuffer);
  const entryCount = readUInt16LE(zipBuffer, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32LE(zipBuffer, eocdOffset + 16);
  const entries: CentralDirectoryEntry[] = [];

  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(zipBuffer, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('无效的 ZIP 文件：中央目录记录损坏。');
    }

    const flags = readUInt16LE(zipBuffer, offset + 8);
    const method = readUInt16LE(zipBuffer, offset + 10);
    const crc32 = readUInt32LE(zipBuffer, offset + 16);
    const compressedSize = readUInt32LE(zipBuffer, offset + 20);
    const uncompressedSize = readUInt32LE(zipBuffer, offset + 24);
    const fileNameLength = readUInt16LE(zipBuffer, offset + 28);
    const extraLength = readUInt16LE(zipBuffer, offset + 30);
    const commentLength = readUInt16LE(zipBuffer, offset + 32);
    const localHeaderOffset = readUInt32LE(zipBuffer, offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const extraStart = fileNameEnd;
    const extraEnd = extraStart + extraLength;
    const nameEncoding: BufferEncoding = (flags & 0x0800) === 0x0800 ? 'utf8' : 'utf8';
    const name = zipBuffer.subarray(fileNameStart, fileNameEnd).toString(nameEncoding);
    const aesInfo = parseAesExtraField(zipBuffer.subarray(extraStart, extraEnd));

    entries.push({
      name,
      method,
      flags,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      ...aesInfo,
    });

    offset = extraEnd + commentLength;
  }

  return entries;
};

const readEntryCompressedPayload = (zipBuffer: Buffer, entry: CentralDirectoryEntry): Buffer => {
  const localHeaderOffset = entry.localHeaderOffset;
  if (readUInt32LE(zipBuffer, localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`无效的 ZIP 文件：${entry.name} 的本地文件头损坏。`);
  }

  const localFileNameLength = readUInt16LE(zipBuffer, localHeaderOffset + 26);
  const localExtraLength = readUInt16LE(zipBuffer, localHeaderOffset + 28);
  const payloadOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
  return zipBuffer.subarray(payloadOffset, payloadOffset + entry.compressedSize);
};

const deriveAesKeys = (password: string | Buffer, salt: Buffer): DerivedAesKeys => {
  const passwordBuffer = Buffer.isBuffer(password) ? password : Buffer.from(password, 'utf8');
  const compositeKey = crypto.pbkdf2Sync(
    passwordBuffer,
    salt,
    PBKDF2_ITERATIONS,
    AES_256_KEY_LENGTH * 2 + AES_PASSWORD_VERIFIER_LENGTH,
    'sha1',
  );
  return {
    aesKey: compositeKey.subarray(0, AES_256_KEY_LENGTH),
    hmacKey: compositeKey.subarray(AES_256_KEY_LENGTH, AES_256_KEY_LENGTH * 2),
    passwordVerifier: compositeKey.subarray(AES_256_KEY_LENGTH * 2),
  };
};

const createWinZipAesCounter = () => {
  const counter = new aes.Counter(Buffer.from('01000000000000000000000000000000', 'hex'));
  counter.increment = function increment() {
    for (let index = 0; index < 16; index += 1) {
      if (this._counter[index] === 255) {
        this._counter[index] = 0;
      } else {
        this._counter[index] += 1;
        break;
      }
    }
  };
  return counter;
};

const decryptWinZipAesPayload = (payload: Buffer, password: string | Buffer, entry: CentralDirectoryEntry): Buffer => {
  if (entry.aesStrength !== 3 || entry.aesCompressionMethod === undefined) {
    throw new Error(`不支持的 ZIP AES 加密格式：${entry.name}`);
  }
  if (payload.length < AES_256_SALT_LENGTH + AES_PASSWORD_VERIFIER_LENGTH + AES_AUTH_CODE_LENGTH) {
    throw new Error(`ZIP 条目 ${entry.name} 的加密数据不完整。`);
  }

  const salt = payload.subarray(0, AES_256_SALT_LENGTH);
  const passwordVerifier = payload.subarray(AES_256_SALT_LENGTH, AES_256_SALT_LENGTH + AES_PASSWORD_VERIFIER_LENGTH);
  const encryptedData = payload.subarray(AES_256_SALT_LENGTH + AES_PASSWORD_VERIFIER_LENGTH, payload.length - AES_AUTH_CODE_LENGTH);
  const expectedAuthCode = payload.subarray(payload.length - AES_AUTH_CODE_LENGTH);
  const keys = deriveAesKeys(password, salt);

  if (!crypto.timingSafeEqual(passwordVerifier, keys.passwordVerifier)) {
    throw new Error('ZIP 解压密码错误。');
  }

  const actualAuthCode = crypto.createHmac('sha1', keys.hmacKey).update(encryptedData).digest().subarray(0, AES_AUTH_CODE_LENGTH);
  if (!crypto.timingSafeEqual(actualAuthCode, expectedAuthCode)) {
    throw new Error(`ZIP 条目 ${entry.name} 的数据校验失败。`);
  }

  const cipher = new aes.ModeOfOperation.ctr(new Uint8Array(keys.aesKey), createWinZipAesCounter());
  return Buffer.from(cipher.decrypt(new Uint8Array(encryptedData)));
};

const inflateEntryData = (compressedData: Buffer, method: number, entryName: string): Buffer => {
  if (method === COMPRESSION_STORED) return compressedData;
  if (method === COMPRESSION_DEFLATED) return zlib.inflateRawSync(compressedData);
  throw new Error(`不支持的 ZIP 压缩方式：${entryName} (${method})。`);
};

export function readEncryptedZipEntries(zipBuffer: Buffer, password: string): Map<string, Buffer> {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw new Error('导入文件为空或格式无效。');
  }
  if (!password) {
    throw new Error('缺少 ZIP 解压密码。');
  }

  const result = new Map<string, Buffer>();
  const entries = parseCentralDirectoryEntries(zipBuffer);

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;

    const payload = readEntryCompressedPayload(zipBuffer, entry);
    const compressedData = entry.method === WINZIP_AES_METHOD
      ? decryptWinZipAesPayload(payload, password, entry)
      : payload;
    const actualCompressionMethod = entry.method === WINZIP_AES_METHOD
      ? entry.aesCompressionMethod!
      : entry.method;
    const data = inflateEntryData(compressedData, actualCompressionMethod, entry.name);

    if (entry.uncompressedSize !== 0xffffffff && data.length !== entry.uncompressedSize) {
      throw new Error(`ZIP 条目 ${entry.name} 解压后大小不匹配。`);
    }

    result.set(entry.name.replace(/\\/g, '/'), data);
  }

  return result;
}
