import type { ConnectionFolderInfo, ConnectionInfo } from '../../stores/connections.store';

export interface ConnectionFilterControls {
  folderId: number | null;
  tagIdList: number[];
  searchQuery: string;
}

export const compareManualConnectionOrder = <T extends { sort_order?: number; name?: string | null; id: number }>(a: T, b: T) => {
  const orderA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER;
  const orderB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const nameCompare = (a.name || '').localeCompare(b.name || '');
  return nameCompare !== 0 ? nameCompare : a.id - b.id;
};

export const getDescendantFolderIds = (folderId: number, folderList: ConnectionFolderInfo[]): Set<number> => {
  const descendantIdSet = new Set<number>();
  const childrenByParent = new Map<number | null, ConnectionFolderInfo[]>();
  folderList.forEach(folder => {
    const parentId = folder.parent_id ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });
  const collect = (parentId: number) => {
    (childrenByParent.get(parentId) ?? []).forEach(child => {
      if (descendantIdSet.has(child.id)) return;
      descendantIdSet.add(child.id);
      collect(child.id);
    });
  };
  collect(folderId);
  return descendantIdSet;
};

export const filterAndSortConnections = (
  connectionList: ConnectionInfo[],
  folderList: ConnectionFolderInfo[],
  controls: ConnectionFilterControls,
): ConnectionInfo[] => {
  const query = controls.searchQuery.toLowerCase().trim();
  const allowedFolderIdSet = controls.folderId === null
    ? null
    : new Set([controls.folderId, ...getDescendantFolderIds(controls.folderId, folderList)]);
  return connectionList.filter(connection => {
    if (allowedFolderIdSet && (connection.folder_id == null || !allowedFolderIdSet.has(connection.folder_id))) return false;
    if (controls.tagIdList.length > 0 && !controls.tagIdList.some(tagId => (connection.tag_ids ?? []).includes(tagId))) return false;
    if (!query) return true;
    return [connection.name, connection.username, connection.host, connection.port?.toString(), connection.notes]
      .some(value => value?.toLowerCase().includes(query));
  }).sort(compareManualConnectionOrder);
};
