import assert from 'node:assert/strict';
import {
  resolveApiBaseUrl,
  resolveWebSocketBaseUrl,
} from '../src/utils/runtimeConfig';

const electronProdEnv = {
  isElectron: true,
  isProd: true,
  locationProtocol: 'http:',
  locationHost: 'localhost:22457',
};

assert.equal(
  resolveApiBaseUrl(electronProdEnv),
  'http://localhost:22458/api/v1',
  'Electron production should call the backend service directly',
);

assert.equal(
  resolveWebSocketBaseUrl(electronProdEnv),
  'ws://localhost:22458/ws/',
  'Electron production should connect WebSocket directly to the backend service',
);

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
  resolveWebSocketBaseUrl({
    isElectron: false,
    isProd: false,
    locationProtocol: 'http:',
    locationHost: 'localhost:5173',
  }),
  'ws://localhost:5173/ws/',
  'Browser development should keep using the current origin so Vite proxy handles WebSocket',
);

console.log('electronRuntimeConfig behavior tests passed');
