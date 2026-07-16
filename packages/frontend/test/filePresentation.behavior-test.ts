import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatFileSize,
  formatUnixFileMode,
  resolveFileIconClass,
} from '../src/features/file-manager/file-presentation';

assert.equal(formatFileSize(0), '0 B');
assert.equal(formatFileSize(1024), '1.0 KB');
assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
assert.equal(formatFileSize(1024 * 1024 * 1024), '1.0 GB');

assert.equal(formatUnixFileMode(0o755), 'rwxr-xr-x');
assert.equal(formatUnixFileMode(0o100644), 'rw-r--r--');

assert.equal(resolveFileIconClass('Dockerfile'), 'fab fa-docker');
assert.equal(resolveFileIconClass('.env.production'), 'fas fa-shield-alt');
assert.equal(resolveFileIconClass('photo.PNG'), 'fas fa-file-image');
assert.equal(resolveFileIconClass('unknown.filetype'), 'far fa-file');

const fileManager = readFileSync(resolve('src/components/FileManager.vue'), 'utf8');
assert.match(
  fileManager,
  /from '\.\.\/features\/file-manager\/file-presentation';/,
  'FileManager should import its display-only rules from the feature module',
);
assert.match(fileManager, /resolveFileIconClass\(item\.filename\)/);
assert.match(fileManager, /formatFileSize\(item\.attrs\.size\)/);
assert.match(fileManager, /formatUnixFileMode\(item\.attrs\.mode\)/);
assert.doesNotMatch(fileManager, /const getFileIconClassBase\s*=/);

console.log('file presentation behavior ok');
