import assert from 'node:assert/strict';

import { filterAndSortConnections } from '../src/features/connections/connection-filtering';

const folderList = [
  { id: 10, parent_id: null },
  { id: 11, parent_id: 10 },
  { id: 12, parent_id: 11 },
] as any;
const connectionList = [
  { id: 1, name: 'Zulu', host: '10.0.0.1', folder_id: 10, tag_ids: [1], sort_order: 2 },
  { id: 2, name: 'Alpha', host: '10.0.0.2', folder_id: 12, tag_ids: [2], sort_order: 1, notes: 'production' },
  { id: 3, name: 'Other', host: '10.0.0.3', folder_id: null, tag_ids: [2], sort_order: 0 },
] as any;

assert.deepEqual(filterAndSortConnections(connectionList, folderList, {
  folderId: 10,
  tagIdList: [],
  searchQuery: '',
}).map(item => item.id), [2, 1]);
assert.deepEqual(filterAndSortConnections(connectionList, folderList, {
  folderId: 10,
  tagIdList: [2],
  searchQuery: 'production',
}).map(item => item.id), [2]);
assert.deepEqual(filterAndSortConnections(connectionList, folderList, {
  folderId: null,
  tagIdList: [2],
  searchQuery: '10.0.0',
}).map(item => item.id), [3, 2]);

console.log('connection filtering behavior ok');
