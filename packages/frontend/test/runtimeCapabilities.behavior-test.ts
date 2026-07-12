import assert from 'node:assert/strict';

import {
  isAccountFeatureAvailable,
  isRemoteDesktopFeatureAvailable,
  resolveRuntimeCapabilities,
  RuntimeConfigEnv,
} from '../src/utils/runtimeConfig';

const desktop: RuntimeConfigEnv = {
  isElectron: true, isProd: true, locationProtocol: 'file:', locationHost: '',
};
const web: RuntimeConfigEnv = {
  isElectron: false, isProd: true, locationProtocol: 'https:', locationHost: 'terminal.example.com',
};

assert.deepEqual(resolveRuntimeCapabilities(desktop), {
  runtime: 'desktop', requiresAuthentication: false, remoteDesktop: false, multiUserAdministration: false,
});
assert.equal(isAccountFeatureAvailable(desktop), false);
assert.equal(isRemoteDesktopFeatureAvailable(desktop), false);
assert.deepEqual(resolveRuntimeCapabilities(web), {
  runtime: 'web', requiresAuthentication: true, remoteDesktop: true, multiUserAdministration: true,
});
