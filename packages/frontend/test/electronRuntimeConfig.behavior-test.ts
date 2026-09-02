import assert from 'node:assert/strict';
import {
  isAccountFeatureAvailable,
  isRemoteDesktopFeatureAvailable,
  readRuntimeConfigEnv,
  resolveIsElectronRuntime,
  resolveApiBaseUrl,
  resolveRemoteDesktopProxyWebSocketUrl,
  resolveWebSocketBaseUrl,
} from '../src/utils/runtimeConfig';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const nodeRuntimeEnv = readRuntimeConfigEnv();
assert.equal(nodeRuntimeEnv.isElectron, false, 'Node runtime must default to web capabilities');
assert.equal(nodeRuntimeEnv.isProd, false, 'Node runtime must default to non-production mode');
assert.equal(nodeRuntimeEnv.locationProtocol, 'http:');
assert.equal(nodeRuntimeEnv.locationHost, '');

assert.equal(
  resolveIsElectronRuntime('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false),
  false,
  'A browser visiting an Electron-marked dev bundle must use web runtime behavior',
);

assert.equal(
  resolveIsElectronRuntime('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true),
  true,
  'The Electron preload bridge must identify the desktop runtime',
);

const viteConfigSource = readFileSync(resolve('vite.config.ts'), 'utf8');
assert.equal(
  (viteConfigSource.match(/changeOrigin:\s*false/g) ?? []).length,
  3,
  'Development HTTP and WebSocket proxies must preserve the browser Host header',
);
assert.doesNotMatch(
  viteConfigSource,
  /changeOrigin:\s*true/,
  'Development proxies must not replace the public frontend origin with the backend origin',
);

const electronProdEnv = {
  isElectron: true,
  isProd: true,
  locationProtocol: 'http:',
  locationHost: 'localhost:22457',
};

assert.equal(
  resolveApiBaseUrl(electronProdEnv),
  'http://127.0.0.1:22458/api/v1',
  'Electron production should call the backend service directly',
);

assert.equal(
  resolveWebSocketBaseUrl(electronProdEnv),
  'ws://127.0.0.1:22458/ws/',
  'Electron production should connect WebSocket directly to the backend service',
);

assert.equal(
  isRemoteDesktopFeatureAvailable(electronProdEnv),
  false,
  'Electron production should not expose RDP/VNC because guacd is not packaged',
);

assert.equal(
  isAccountFeatureAvailable(electronProdEnv),
  false,
  'Electron production should not expose account login features',
);

assert.equal(
  isRemoteDesktopFeatureAvailable({
    isElectron: true,
    isProd: false,
    locationProtocol: 'http:',
    locationHost: 'localhost:22457',
  }),
  false,
  'Electron development should not expose RDP/VNC because dev:app does not start guacd',
);

const electronDevEnv = {
  isElectron: true,
  isProd: false,
  locationProtocol: 'http:',
  locationHost: 'localhost:22457',
};
assert.equal(resolveApiBaseUrl(electronDevEnv), 'http://127.0.0.1:22458/api/v1');
assert.equal(resolveWebSocketBaseUrl(electronDevEnv), 'ws://127.0.0.1:22458/ws/');

assert.equal(
  resolveApiBaseUrl({
    isElectron: false,
    isProd: true,
    locationProtocol: 'https:',
    locationHost: 'fantetic.example.com',
  }),
  '/api/v1',
  'Web production should keep using relative API paths',
);

assert.equal(
  isRemoteDesktopFeatureAvailable({
    isElectron: false,
    isProd: true,
    locationProtocol: 'https:',
    locationHost: 'fantetic.example.com',
  }),
  true,
  'Web production should keep RDP/VNC available for Guacamole deployments',
);

assert.equal(
  isAccountFeatureAvailable({
    isElectron: false,
    isProd: true,
    locationProtocol: 'https:',
    locationHost: 'fantetic.example.com',
  }),
  true,
  'Web production should keep account login features available',
);

assert.equal(
  resolveWebSocketBaseUrl({
    isElectron: false,
    isProd: false,
    locationProtocol: 'http:',
    locationHost: 'localhost:5173',
  }),
  'ws://localhost:5173/ws/',
  'Browser development should keep using the current origin so Vite proxy handles WebSocket',
);

assert.equal(
  resolveRemoteDesktopProxyWebSocketUrl('token-value', 1280, 720, {
    isElectron: false,
    isProd: true,
    locationProtocol: 'https:',
    locationHost: 'fantetic.example.com',
  }),
  'wss://fantetic.example.com/ws/rdp-proxy?token=token-value&width=1280&height=720&dpi=96',
  'Web production RDP/VNC should keep using the current host proxy',
);

console.log('electronRuntimeConfig behavior tests passed');
