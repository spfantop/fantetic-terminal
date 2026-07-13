import ipaddr from 'ipaddr.js';

const DEFAULT_TRUSTED_PROXY_CIDRS = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
  'fe80::/10',
].join(',');

type ClientAddressInput = {
  remoteAddress: string | undefined;
  forwardedFor?: string | string[];
};

export type ClientIpResolver = {
  isTrustedProxy: (address: string) => boolean;
  resolve: (input: ClientAddressInput) => string;
};

const normalizeAddress = (address: string): ipaddr.IPv4 | ipaddr.IPv6 => ipaddr.process(address.trim());

export const createClientIpResolver = (
  configuredCidrs = process.env.TRUSTED_PROXY_CIDRS || DEFAULT_TRUSTED_PROXY_CIDRS,
): ClientIpResolver => {
  const trustedRanges = configuredCidrs
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ipaddr.parseCIDR(entry));

  const isTrustedProxy = (address: string): boolean => {
    try {
      const parsedAddress = normalizeAddress(address);
      return trustedRanges.some(([rangeAddress, prefixLength]) => {
        if (parsedAddress.kind() === 'ipv4' && rangeAddress.kind() === 'ipv4') {
          return (parsedAddress as ipaddr.IPv4).match(rangeAddress as ipaddr.IPv4, prefixLength);
        }
        if (parsedAddress.kind() === 'ipv6' && rangeAddress.kind() === 'ipv6') {
          return (parsedAddress as ipaddr.IPv6).match(rangeAddress as ipaddr.IPv6, prefixLength);
        }
        return false;
      });
    } catch {
      return false;
    }
  };

  const resolve = ({ remoteAddress, forwardedFor }: ClientAddressInput): string => {
    if (!remoteAddress) return 'unknown';

    let currentAddress: string;
    try {
      currentAddress = normalizeAddress(remoteAddress).toString();
    } catch {
      return 'unknown';
    }

    if (!isTrustedProxy(currentAddress)) return currentAddress;

    const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const forwardedChain = forwardedValue
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

    for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
      let candidate: string;
      try {
        candidate = normalizeAddress(forwardedChain[index]).toString();
      } catch {
        continue;
      }

      currentAddress = candidate;
      if (!isTrustedProxy(candidate)) break;
    }

    return currentAddress;
  };

  return { isTrustedProxy, resolve };
};
