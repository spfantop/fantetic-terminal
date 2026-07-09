<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { ComponentPublicInstance } from 'vue';
import draggable from 'vuedraggable';
import AddConnectionForm from '../components/AddConnectionForm.vue';
import BatchEditConnectionForm from '../components/BatchEditConnectionForm.vue';
import ServerIcon from '../components/ServerIcon.vue';
import WorkspaceView from './WorkspaceView.vue';
import { useConnectionsStore } from '../stores/connections.store';
import { useSessionStore } from '../stores/session.store';
import { useTagsStore } from '../stores/tags.store';
import { useAuthStore } from '../stores/auth.store';
import type { TagInfo } from '../stores/tags.store';
import { useI18n } from 'vue-i18n';
import type { ConnectionInfo } from '../stores/connections.store';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useAlertDialog } from '../composables/useAlertDialog';
import { storeToRefs } from 'pinia';
import type { ConnectionFolderInfo } from '../stores/connections.store';
import { beginGlobalDragSelectionGuard } from '../composables/useGlobalDragSelectionGuard';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import { useThemeToggle } from '../composables/useThemeToggle';
import { isAccountFeatureAvailable } from '../utils/runtimeConfig';
import { useDeviceDetection } from '../composables/useDeviceDetection';
import {
  createLongPressContextMenuEvent,
  createMobileLongPressHandlers,
  type MobileLongPressHandlers,
} from '../composables/useMobileLongPress';

const { t } = useI18n();
const { showConfirmDialog } = useConfirmDialog();
const { showAlertDialog } = useAlertDialog();
const connectionsStore = useConnectionsStore();
const sessionStore = useSessionStore();
const tagsStore = useTagsStore();
const authStore = useAuthStore();
const emitWorkspaceEvent = useWorkspaceEventEmitter();
const accountFeatureAvailable = isAccountFeatureAvailable();
const { isMobile } = useDeviceDetection();
const {
  isDarkUiThemeActive,
  isSwitchingTheme,
  themeToggleLabel,
  toggleTheme,
} = useThemeToggle(t);

const { connections, folders, isLoading: isLoadingConnections, isFoldersLoading } = storeToRefs(connectionsStore);
const { tags } = storeToRefs(tagsStore);
const { isAuthenticated } = storeToRefs(authStore);

const LS_FILTER_FOLDER_KEY = 'connections_view_filter_folder';
const LS_FILTER_TAGS_KEY = 'connections_view_filter_tags';
const LS_SERVER_PANEL_WIDTH_KEY = 'connections_view_server_panel_width';
const LS_SERVER_PANEL_COLLAPSED_KEY = 'connections_view_server_panel_collapsed';
const SERVER_PANEL_COLLAPSED_EVENT = 'fantetic:connections-server-panel-collapsed';
const SERVER_PANEL_TOGGLE_EVENT = 'fantetic:connections-server-panel-toggle';
const SERVER_ACTION_MENU_CLOSE_DELAY_MS = 220;
const SERVER_PANEL_MIN_WIDTH = 280;
const SERVER_PANEL_DEFAULT_WIDTH = SERVER_PANEL_MIN_WIDTH;
const SERVER_PANEL_MAX_WIDTH = 560;
const SERVER_PANEL_COLLAPSED_WIDTH = 6;
const SERVER_PANEL_COLLAPSE_THRESHOLD = 180;
const SERVER_PANEL_AUTO_COLLAPSE_WIDTH = 900;

interface ServerFolderGroup {
  key: string;
  folderId: number;
  parentId: number | null;
  depth: number;
  name: string;
  connections: ConnectionInfo[];
  totalConnectionCount: number;
}

interface ServerEntryMeta {
  tagNames: string[];
  detailRows: Array<{ key: string; label: string; value: string }>;
  detailTitle: string;
  truncatedNotes: string;
}

type ConnectionDragEndEvent = {
  from?: HTMLElement | null;
  to?: HTMLElement | null;
  item?: HTMLElement | null;
  newIndex?: number;
};

type FolderDropPosition = 'before' | 'after' | 'inside';

const clampServerPanelWidth = (width: number) => {
  return Math.min(SERVER_PANEL_MAX_WIDTH, Math.max(SERVER_PANEL_MIN_WIDTH, Math.round(width)));
};

const getInitialServerPanelWidth = () => {
  const savedWidth = Number(localStorage.getItem(LS_SERVER_PANEL_WIDTH_KEY));
  return Number.isFinite(savedWidth) && savedWidth > 0
    ? clampServerPanelWidth(savedWidth)
    : SERVER_PANEL_DEFAULT_WIDTH;
};

const getInitialServerPanelCollapsed = () => {
  return localStorage.getItem(LS_SERVER_PANEL_COLLAPSED_KEY) === 'true';
};

const getInitialSelectedFolderId = (): number | null => {
  const storedValue = localStorage.getItem(LS_FILTER_FOLDER_KEY);
  return storedValue && storedValue !== 'null' ? parseInt(storedValue, 10) : null;
};

const getInitialSelectedTagIds = (): number[] => {
  try {
    const storedValue = localStorage.getItem(LS_FILTER_TAGS_KEY);
    if (!storedValue) return [];
    const parsed = JSON.parse(storedValue);
    return Array.isArray(parsed)
      ? parsed.map(Number).filter(id => Number.isInteger(id) && id > 0)
      : [];
  } catch (error) {
    console.warn('[ConnectionsView] Failed to parse saved tag filters:', error);
    localStorage.removeItem(LS_FILTER_TAGS_KEY);
    return [];
  }
};

const selectedFolderId = ref<number | null>(getInitialSelectedFolderId());
const selectedTagIds = ref<number[]>(getInitialSelectedTagIds());
const searchQuery = ref('');
const serverListPanelRef = ref<HTMLElement | null>(null);
const tagFilterButtonRef = ref<HTMLElement | null>(null);
const tagFilterMenuRef = ref<HTMLElement | null>(null);
const tagFilterMenuStyle = ref<Record<string, string>>({});
const serverActionButtonRef = ref<HTMLElement | null>(null);
const serverActionMenuRef = ref<HTMLElement | null>(null);
const serverPanelWidth = ref(getInitialServerPanelWidth());
const isServerPanelCollapsed = ref(getInitialServerPanelCollapsed());
const isServerPanelResizing = ref(false);
const serverPanelResizeOriginLeft = ref(0);
let releaseServerPanelResizeGuard: (() => void) | null = null;
let serverPanelResizeFrameId: number | null = null;
let pendingServerPanelWidth: number | null = null;
let serverActionMenuCloseTimer: number | null = null;
const isTagFilterOpen = ref(false);
const isServerActionMenuOpen = ref(false);
const isDraggingConnection = ref(false);
const expandedServerFolders = ref<Record<string, boolean>>({});
const editingFolderId = ref<number | null>(null);
const editingFolderName = ref('');
const folderRenameInputRef = ref<HTMLInputElement | null>(null);
const isSavingFolderRename = ref(false);
const draggingFolderId = ref<number | null>(null);
const folderDropTarget = ref<{ folderId: number | null; position: FolderDropPosition } | null>(null);
const serverContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  targetFolderId: null as number | null,
  targetType: 'root' as 'root' | 'folder' | 'connection',
  targetConnectionId: null as number | null,
});

const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const initialConnectionTagIds = ref<number[]>([]);
const initialConnectionFolderId = ref<number | null>(null);

// Batch Edit Mode
const isBatchEditMode = ref(false);
const selectedConnectionIdsForBatch = ref<Set<number>>(new Set());
const showBatchEditForm = ref(false);
const isDeletingSelectedConnections = ref(false);

const compareManualOrder = <T extends { sort_order?: number; name?: string | null; id: number }>(a: T, b: T) => {
  const orderA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER;
  const orderB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const nameCompare = (a.name || '').localeCompare(b.name || '');
  return nameCompare !== 0 ? nameCompare : a.id - b.id;
};

const connectionMatchesTagFilter = (conn: ConnectionInfo) => {
  if (selectedTagIds.value.length === 0) return true;
  const connectionTagIds = conn.tag_ids ?? [];
  return selectedTagIds.value.some(tagId => connectionTagIds.includes(tagId));
};

const getDescendantFolderIds = (folderId: number) => {
  const descendantIds = new Set<number>();
  const childrenByParent = new Map<number | null, ConnectionFolderInfo[]>();

  folders.value.forEach((folder) => {
    const parentId = folder.parent_id ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });

  const collect = (parentId: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((child) => {
      if (descendantIds.has(child.id)) return;
      descendantIds.add(child.id);
      collect(child.id);
    });
  };

  collect(folderId);
  return descendantIds;
};

const filterConnectionsByControls = (sourceConnections: ConnectionInfo[]) => {
  const filterFolderId = selectedFolderId.value;
  const query = searchQuery.value.toLowerCase().trim();

  const allowedFolderIds = filterFolderId === null ? null : new Set([filterFolderId, ...getDescendantFolderIds(filterFolderId)]);
  let filteredByFolder = allowedFolderIds === null
    ? [...sourceConnections]
    : sourceConnections.filter(conn => conn.folder_id !== null && typeof conn.folder_id !== 'undefined' && allowedFolderIds.has(conn.folder_id));

  filteredByFolder = filteredByFolder.filter(connectionMatchesTagFilter);

  let searchedConnections = filteredByFolder;
  if (query) {
    searchedConnections = filteredByFolder.filter(conn => {
      const nameMatch = conn.name?.toLowerCase().includes(query);
      const usernameMatch = conn.username?.toLowerCase().includes(query);
      const hostMatch = conn.host?.toLowerCase().includes(query);
      const portMatch = conn.port?.toString().includes(query);
      const notesMatch = conn.notes?.toLowerCase().includes(query); // 添加对备注的搜索
      return nameMatch || usernameMatch || hostMatch || portMatch || notesMatch;
    });
  }

  return searchedConnections;
};

const manualOrderedFilteredConnections = computed(() => {
  return filterConnectionsByControls(connections.value).sort(compareManualOrder);
});

const filteredAndSortedConnections = computed(() => manualOrderedFilteredConnections.value);
const selectedBatchConnections = computed(() => (
  connections.value
    .filter(conn => selectedConnectionIdsForBatch.value.has(conn.id))
    .sort(compareManualOrder)
));
const commandTargetConnections = computed(() => (
  isBatchEditMode.value
    ? selectedBatchConnections.value
    : filteredAndSortedConnections.value
));
const commandTargetSshConnections = computed(() => commandTargetConnections.value.filter(conn => conn.type === 'SSH'));
const connectAllActionTitle = computed(() => (
  isBatchEditMode.value
    ? t('connections.actions.connectSelected', '连接选中')
    : t('workspaceConnectionList.connectAllSshInGroupMenu', '连接全部')
));
const openAllActionTitle = computed(() => (
  isBatchEditMode.value
    ? t('connections.actions.openSelected', '打开选中')
    : t('connections.actions.openAll', '打开全部')
));

const serverListPanelStyle = computed(() => ({
  width: `${isServerPanelCollapsed.value ? SERVER_PANEL_COLLAPSED_WIDTH : serverPanelWidth.value}px`,
  minWidth: `${isServerPanelCollapsed.value ? SERVER_PANEL_COLLAPSED_WIDTH : serverPanelWidth.value}px`,
}));

const folderKey = (folderId: number | null) => (folderId === null ? 'unfoldered' : `folder-${folderId}`);

const isFolderExpanded = (folderId: number | null) => {
  const key = folderKey(folderId);
  return expandedServerFolders.value[key] ?? true;
};

const toggleFolder = (folderId: number | null) => {
  if (editingFolderId.value !== null && editingFolderId.value === folderId) return;

  const key = folderKey(folderId);
  expandedServerFolders.value[key] = !isFolderExpanded(folderId);
};

const focusFolderRenameInput = async () => {
  await nextTick();
  folderRenameInputRef.value?.focus();
  folderRenameInputRef.value?.select();
};

const setFolderRenameInputRef = (element: Element | ComponentPublicInstance | null) => {
  folderRenameInputRef.value = element instanceof HTMLInputElement ? element : null;
};

const startRenameFolder = (folder: ServerFolderGroup) => {
  if (folder.folderId === null) return;

  editingFolderId.value = folder.folderId;
  editingFolderName.value = folder.name;
  focusFolderRenameInput();
};

const cancelRenameFolder = () => {
  editingFolderId.value = null;
  editingFolderName.value = '';
};

const submitFolderRename = async (folder: ServerFolderGroup) => {
  if (folder.folderId === null || isSavingFolderRename.value) return;

  const nextName = editingFolderName.value.trim();
  if (!nextName) {
    editingFolderName.value = folder.name;
    cancelRenameFolder();
    return;
  }

  if (nextName === folder.name) {
    cancelRenameFolder();
    return;
  }

  const alreadyExists = folders.value.some(item => (
    item.id !== folder.folderId && item.name.toLowerCase() === nextName.toLowerCase()
  ));

  if (alreadyExists) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: t('connections.folders.folderExists', { name: nextName }, `文件夹 "${nextName}" 已存在。`),
    });
    editingFolderName.value = folder.name;
    focusFolderRenameInput();
    return;
  }

  isSavingFolderRename.value = true;
  try {
    const success = await connectionsStore.updateFolder(folder.folderId, nextName);
    if (!success) {
      showAlertDialog({
        title: t('common.error', '错误'),
        message: t('connections.folders.renameFailed', { name: folder.name, error: connectionsStore.error || t('common.unknownError', '未知错误') }),
      });
      editingFolderName.value = folder.name;
      focusFolderRenameInput();
      return;
    }
    cancelRenameFolder();
  } finally {
    isSavingFolderRename.value = false;
  }
};

const unfiledServerEntries = computed<ConnectionInfo[]>(() => (
  selectedFolderId.value === null
    ? manualOrderedFilteredConnections.value.filter(conn => !conn.folder_id)
    : []
));

const groupedServerFolders = computed<ServerFolderGroup[]>(() => {
  const query = searchQuery.value.trim();
  const hasActiveFilter = Boolean(query) || selectedTagIds.value.length > 0;
  const folderMap = new Map(folders.value.map(folder => [folder.id, folder]));
  const childrenByParent = new Map<number | null, ConnectionFolderInfo[]>();
  folders.value.forEach((folder) => {
    const parentId = folder.parent_id ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });
  childrenByParent.forEach(children => children.sort(compareManualOrder));

  const connectionCountByFolder = new Map<number, number>();
  manualOrderedFilteredConnections.value.forEach((conn) => {
    if (conn.folder_id === null || typeof conn.folder_id === 'undefined') return;
    connectionCountByFolder.set(conn.folder_id, (connectionCountByFolder.get(conn.folder_id) ?? 0) + 1);
  });

  const getFolderTotalConnectionCount = (folderId: number, countingFolderIds = new Set<number>()): number => {
    if (countingFolderIds.has(folderId)) return 0;
    countingFolderIds.add(folderId);

    const childTotal = (childrenByParent.get(folderId) ?? []).reduce((total, child) => (
      total + getFolderTotalConnectionCount(child.id, countingFolderIds)
    ), 0);

    countingFolderIds.delete(folderId);
    return (connectionCountByFolder.get(folderId) ?? 0) + childTotal;
  };

  const visited = new Set<number>();
  const buildRowsForFolder = (folder: ConnectionFolderInfo, depth: number): ServerFolderGroup[] => {
    if (visited.has(folder.id)) return [];
    visited.add(folder.id);

    const childRows = (childrenByParent.get(folder.id) ?? []).flatMap(child => buildRowsForFolder(child, depth + 1));
    const folderConnections = manualOrderedFilteredConnections.value.filter(conn => conn.folder_id === folder.id);
    const shouldShowFolder = folderConnections.length > 0
      || childRows.length > 0
      || !hasActiveFilter
      || folder.id === editingFolderId.value;

    if (!shouldShowFolder) {
      return childRows;
    }

    return [
      {
        key: folderKey(folder.id),
        folderId: folder.id,
        parentId: folder.parent_id ?? null,
        depth,
        name: folder.name,
        connections: folderConnections,
        totalConnectionCount: getFolderTotalConnectionCount(folder.id),
      },
      ...((isFolderExpanded(folder.id) || hasActiveFilter) ? childRows : []),
    ];
  };

  if (selectedFolderId.value !== null) {
    const selectedFolder = folderMap.get(selectedFolderId.value);
    return selectedFolder ? buildRowsForFolder(selectedFolder, 0) : [];
  }

  const rootRows = (childrenByParent.get(null) ?? []).flatMap(folder => buildRowsForFolder(folder, 0));
  const orphanRows = folders.value
    .filter(folder => !visited.has(folder.id))
    .flatMap(folder => buildRowsForFolder(folder, 0));

  return [...rootRows, ...orphanRows];
});

const folderFilterOptions = computed(() => {
  const folderMap = new Map(folders.value.map(folder => [folder.id, folder]));
  const childrenByParent = new Map<number | null, ConnectionFolderInfo[]>();
  folders.value.forEach((folder) => {
    const parentId = folder.parent_id ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });
  childrenByParent.forEach(children => children.sort(compareManualOrder));

  const options: Array<{ id: number; label: string }> = [];
  const visited = new Set<number>();
  const appendChildren = (parentId: number | null, depth: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((folder) => {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      options.push({
        id: folder.id,
        label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${folder.name}`,
      });
      appendChildren(folder.id, depth + 1);
    });
  };

  appendChildren(null, 0);
  folders.value
    .filter(folder => !visited.has(folder.id) && (!folder.parent_id || !folderMap.has(folder.parent_id)))
    .forEach((folder) => {
      visited.add(folder.id);
      options.push({ id: folder.id, label: folder.name });
      appendChildren(folder.id, 1);
    });

  return options;
});

const hasVisibleServerTreeItems = computed(() => groupedServerFolders.value.length > 0 || unfiledServerEntries.value.length > 0);

const canPersistManualOrder = computed(() => !searchQuery.value.trim() && selectedTagIds.value.length === 0);

const persistFolderOrderPayload = async (items: { id: number; parent_id: number | null; sort_order: number }[]) => {
  if (!canPersistManualOrder.value) return;
  if (items.length === 0) return;

  const success = await connectionsStore.reorderFolders(items);
  if (!success) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: connectionsStore.error || t('connections.folders.reorderFailed', '文件夹排序保存失败。'),
    });
  }
};

const folderParentKey = (parentId: number | null) => (parentId === null ? 'root' : String(parentId));

const buildFolderOrderPayload = (
  draggedFolderId: number,
  targetParentId: number | null,
  targetIndex: number,
) => {
  const groups = new Map<string, number[]>();
  const keyToParentId = new Map<string, number | null>();
  const sortedFolders = [...folders.value].sort(compareManualOrder);

  const ensureGroup = (parentId: number | null) => {
    const key = folderParentKey(parentId);
    if (!groups.has(key)) {
      groups.set(key, []);
      keyToParentId.set(key, parentId);
    }
    return groups.get(key)!;
  };

  ensureGroup(null);
  sortedFolders.forEach((folder) => {
    ensureGroup(folder.parent_id ?? null).push(folder.id);
    ensureGroup(folder.id);
  });

  groups.forEach((ids) => {
    const index = ids.indexOf(draggedFolderId);
    if (index !== -1) ids.splice(index, 1);
  });

  const targetGroup = ensureGroup(targetParentId);
  const nextIndex = Math.min(Math.max(targetIndex, 0), targetGroup.length);
  targetGroup.splice(nextIndex, 0, draggedFolderId);

  return Array.from(groups.entries()).flatMap(([key, ids]) => (
    ids.map((id, index) => ({
      id,
      parent_id: keyToParentId.get(key) ?? null,
      sort_order: index,
    }))
  ));
};

const getFolderSiblingIds = (parentId: number | null) => (
  folders.value
    .filter(folder => (folder.parent_id ?? null) === parentId)
    .sort(compareManualOrder)
    .map(folder => folder.id)
);

const isFolderDropAllowed = (draggedFolderId: number, targetParentId: number | null) => {
  if (draggedFolderId === targetParentId) return false;
  return targetParentId === null || !getDescendantFolderIds(draggedFolderId).has(targetParentId);
};

const getFolderHeaderDropPosition = (event: DragEvent): FolderDropPosition => {
  const targetElement = event.currentTarget as HTMLElement | null;
  if (!targetElement) return 'inside';

  const rect = targetElement.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  if (offsetY < rect.height * 0.28) return 'before';
  if (offsetY > rect.height * 0.72) return 'after';
  return 'inside';
};

const handleFolderDragStart = (event: DragEvent, folderId: number) => {
  if (!canPersistManualOrder.value || isBatchEditMode.value) {
    event.preventDefault();
    return;
  }

  draggingFolderId.value = folderId;
  event.dataTransfer?.setData('application/x-fantetic-folder-id', String(folderId));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
};

const handleFolderDragOver = (event: DragEvent, folder: ServerFolderGroup) => {
  const draggedFolderId = draggingFolderId.value;
  if (!draggedFolderId || draggedFolderId === folder.folderId || !canPersistManualOrder.value) return;

  const position = getFolderHeaderDropPosition(event);
  const targetParentId = position === 'inside' ? folder.folderId : folder.parentId;
  if (!isFolderDropAllowed(draggedFolderId, targetParentId)) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  folderDropTarget.value = { folderId: folder.folderId, position };
  if (position === 'inside') {
    expandedServerFolders.value[folderKey(folder.folderId)] = true;
  }
};

const handleFolderDrop = async (event: DragEvent, folder: ServerFolderGroup) => {
  const draggedFolderId = draggingFolderId.value;
  folderDropTarget.value = null;
  if (!draggedFolderId || draggedFolderId === folder.folderId || !canPersistManualOrder.value) return;

  event.preventDefault();
  event.stopPropagation();
  const position = getFolderHeaderDropPosition(event);
  const targetParentId = position === 'inside' ? folder.folderId : folder.parentId;
  if (!isFolderDropAllowed(draggedFolderId, targetParentId)) return;

  const siblingIds = getFolderSiblingIds(targetParentId).filter(id => id !== draggedFolderId);
  const targetSiblingIndex = siblingIds.indexOf(folder.folderId);
  const targetIndex = position === 'inside'
    ? getFolderSiblingIds(folder.folderId).filter(id => id !== draggedFolderId).length
    : Math.max(0, targetSiblingIndex + (position === 'after' ? 1 : 0));

  if (position === 'inside') {
    expandedServerFolders.value[folderKey(folder.folderId)] = true;
  }

  await persistFolderOrderPayload(buildFolderOrderPayload(draggedFolderId, targetParentId, targetIndex));
};

const handleRootFolderDragOver = (event: DragEvent) => {
  const draggedFolderId = draggingFolderId.value;
  if (!draggedFolderId || !canPersistManualOrder.value || !isFolderDropAllowed(draggedFolderId, null)) return;

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  folderDropTarget.value = { folderId: null, position: 'inside' };
};

const handleRootFolderDrop = async (event: DragEvent) => {
  const draggedFolderId = draggingFolderId.value;
  folderDropTarget.value = null;
  if (!draggedFolderId || !canPersistManualOrder.value || !isFolderDropAllowed(draggedFolderId, null)) return;

  event.preventDefault();
  const targetIndex = getFolderSiblingIds(null).filter(id => id !== draggedFolderId).length;
  await persistFolderOrderPayload(buildFolderOrderPayload(draggedFolderId, null, targetIndex));
};

const handleFolderDragEnd = () => {
  draggingFolderId.value = null;
  folderDropTarget.value = null;
};

const isFolderDropTarget = (folderId: number | null, position: FolderDropPosition) => (
  folderDropTarget.value?.folderId === folderId && folderDropTarget.value.position === position
);

const persistConnectionOrderPayload = async (payload: { id: number; folder_id: number | null; sort_order: number }[]) => {
  if (!canPersistManualOrder.value) return;
  if (payload.length === 0) return;

  const success = await connectionsStore.reorderConnections(payload);
  if (!success) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: connectionsStore.error || t('connections.folders.reorderConnectionsFailed', '服务器排序保存失败。'),
    });
  }
};

const parseServerEntriesFolderId = (listElement?: HTMLElement | null): number | null | undefined => {
  const folderValue = listElement?.dataset.folderId;
  if (typeof folderValue === 'undefined') return undefined;
  if (folderValue === '') return null;

  const folderId = Number(folderValue);
  return Number.isInteger(folderId) && folderId > 0 ? folderId : undefined;
};

const buildConnectionOrderPayloadFromDragEvent = (event: ConnectionDragEndEvent) => {
  const draggedConnectionId = Number(event.item?.dataset.connectionId);
  const sourceFolderId = parseServerEntriesFolderId(event.from);
  const targetFolderId = parseServerEntriesFolderId(event.to);

  if (!Number.isInteger(draggedConnectionId) || draggedConnectionId <= 0) return null;
  if (typeof sourceFolderId === 'undefined' || typeof targetFolderId === 'undefined') return null;

  const groups = new Map<string, { folderId: number | null; connections: ConnectionInfo[] }>();
  const ensureGroup = (folderId: number | null) => {
    const key = folderKey(folderId);
    const existing = groups.get(key);
    if (existing) return existing;

    const group = { folderId, connections: [] as ConnectionInfo[] };
    groups.set(key, group);
    return group;
  };

  [...connections.value]
    .sort(compareManualOrder)
    .forEach(conn => {
      ensureGroup(conn.folder_id ?? null).connections.push(conn);
    });

  const sourceGroup = ensureGroup(sourceFolderId);
  const sourceIndex = sourceGroup.connections.findIndex(conn => conn.id === draggedConnectionId);
  if (sourceIndex === -1) return null;

  const [draggedConnection] = sourceGroup.connections.splice(sourceIndex, 1);
  const targetGroup = folderKey(sourceFolderId) === folderKey(targetFolderId)
    ? sourceGroup
    : ensureGroup(targetFolderId);
  const nextIndex = typeof event.newIndex === 'number'
    ? Math.min(Math.max(event.newIndex, 0), targetGroup.connections.length)
    : targetGroup.connections.length;

  targetGroup.connections.splice(nextIndex, 0, {
    ...draggedConnection,
    folder_id: targetFolderId,
  });

  return Array.from(groups.values()).flatMap(group => (
    group.connections.map((conn, index) => ({
      id: conn.id,
      folder_id: group.folderId,
      sort_order: index,
    }))
  ));
};

const buildConnectionOrderPayloadFromDom = () => {
  const connectionMap = new Map(connections.value.map(conn => [conn.id, conn]));
  const seenConnectionIds = new Set<number>();
  const payload: { id: number; folder_id: number | null; sort_order: number }[] = [];
  const lists = Array.from(serverListPanelRef.value?.querySelectorAll<HTMLElement>('.server-entries[data-folder-id]') ?? []);

  lists.forEach((list) => {
    const targetFolderId = parseServerEntriesFolderId(list);
    if (typeof targetFolderId === 'undefined') return;

    Array.from(list.children)
      .map(element => Number((element as HTMLElement).dataset.connectionId))
      .filter(id => Number.isInteger(id) && id > 0 && connectionMap.has(id) && !seenConnectionIds.has(id))
      .forEach((id, index) => {
        seenConnectionIds.add(id);
        payload.push({
          id,
          folder_id: targetFolderId,
          sort_order: index,
        });
      });
  });

  return payload;
};

const handleConnectionDragStart = () => {
  isDraggingConnection.value = true;
};

const handleConnectionDragEnd = async (event: ConnectionDragEndEvent) => {
  isDraggingConnection.value = false;
  if (!canPersistManualOrder.value || !event.to) return;

  const payload = buildConnectionOrderPayloadFromDragEvent(event) ?? buildConnectionOrderPayloadFromDom();
  await persistConnectionOrderPayload(payload);
};

const handleFolderDragEnter = (folderId: number | null) => {
  if (!isDraggingConnection.value || folderId === null) return;
  expandedServerFolders.value[folderKey(folderId)] = true;
};

onMounted(async () => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleServerContextMenuKeydown);
  window.addEventListener('resize', handleServerPanelViewportResize);
  window.addEventListener(SERVER_PANEL_TOGGLE_EVENT, handleServerPanelToggleRequest);
  notifyServerPanelCollapsed();
  handleServerPanelViewportResize();

  if (connections.value.length === 0) {
    try {
      await connectionsStore.fetchConnections();
    } catch (error) {
      console.error("加载连接列表失败:", error);
    }
  }
  try {
    await tagsStore.fetchTags();
  } catch (error) {
    console.error("加载标签列表失败:", error);
  }
  try {
    await connectionsStore.fetchFolders();
  } catch (error) {
    console.error("加载连接文件夹列表失败:", error);
  }
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleServerContextMenuKeydown);
  clearServerActionMenuCloseTimer();
  connectionTestHideTimers.forEach(timer => clearTimeout(timer));
  connectionTestHideTimers.clear();
  window.removeEventListener('resize', handleServerPanelViewportResize);
  window.removeEventListener(SERVER_PANEL_TOGGLE_EVENT, handleServerPanelToggleRequest);
  stopServerPanelResize();
  cancelPendingServerPanelWidth();
});

const connectTo = (connection: ConnectionInfo) => {
  sessionStore.handleConnectRequest(connection, { navigateToWorkspace: false });
};

watch(selectedFolderId, (newValue) => {
  localStorage.setItem(LS_FILTER_FOLDER_KEY, newValue === null ? 'null' : String(newValue));
});

watch(selectedTagIds, (newValue) => {
  localStorage.setItem(LS_FILTER_TAGS_KEY, JSON.stringify(newValue));
});

const selectedTagCount = computed(() => selectedTagIds.value.length);

const isTagSelected = (tagId: number) => selectedTagIds.value.includes(tagId);

const tagNameById = computed(() => new Map((tags.value as TagInfo[]).map(tag => [tag.id, tag.name])));

const updateTagFilterMenuPosition = () => {
  const buttonRect = tagFilterButtonRef.value?.getBoundingClientRect();
  if (!buttonRect) return;

  const menuWidth = Math.min(240, Math.max(0, window.innerWidth * 0.72));
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, buttonRect.right - menuWidth));
  tagFilterMenuStyle.value = {
    position: 'fixed',
    top: `${buttonRect.bottom + 7}px`,
    left: `${left}px`,
    width: `${menuWidth}px`,
  };
};

const toggleTagFilterMenu = () => {
  const nextOpen = !isTagFilterOpen.value;
  if (nextOpen) {
    updateTagFilterMenuPosition();
  }
  isTagFilterOpen.value = nextOpen;
};

const clearServerActionMenuCloseTimer = () => {
  if (serverActionMenuCloseTimer === null) return;
  window.clearTimeout(serverActionMenuCloseTimer);
  serverActionMenuCloseTimer = null;
};

const openServerActionMenu = () => {
  clearServerActionMenuCloseTimer();
  isServerActionMenuOpen.value = true;
};

const toggleTagFilter = (tagId: number) => {
  selectedTagIds.value = isTagSelected(tagId)
    ? selectedTagIds.value.filter(id => id !== tagId)
    : [...selectedTagIds.value, tagId];
};

const clearTagFilters = () => {
  selectedTagIds.value = [];
};

const closeTagFilterMenu = () => {
  isTagFilterOpen.value = false;
};

const closeServerActionMenu = () => {
  clearServerActionMenuCloseTimer();
  isServerActionMenuOpen.value = false;
};

const scheduleServerActionMenuClose = () => {
  if (isMobile.value) return;

  clearServerActionMenuCloseTimer();
  serverActionMenuCloseTimer = window.setTimeout(() => {
    serverActionMenuCloseTimer = null;
    isServerActionMenuOpen.value = false;
  }, SERVER_ACTION_MENU_CLOSE_DELAY_MS);
};

const handleLogout = () => {
  closeServerActionMenu();
  authStore.logout();
};

const getTagNames = (tagIds: number[] | undefined): string[] => {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }
  return tagIds
    .map(id => tagNameById.value.get(id))
    .filter((name): name is string => !!name);
};

const openAddConnectionForm = (folderId: number | null = null) => {
  connectionToEdit.value = null;
  initialConnectionTagIds.value = [];
  initialConnectionFolderId.value = folderId;
  showAddEditConnectionForm.value = true;
};

const openEditConnectionForm = (conn: ConnectionInfo) => {
  initialConnectionTagIds.value = [];
  initialConnectionFolderId.value = null;
  connectionToEdit.value = conn;
  showAddEditConnectionForm.value = true;
};

const handleFormClose = () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
  initialConnectionFolderId.value = null;
};

const handleConnectionModified = async () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
  initialConnectionTagIds.value = [];
  initialConnectionFolderId.value = null;
  await connectionsStore.fetchConnections();
};

const saveServerPanelWidth = () => {
  localStorage.setItem(LS_SERVER_PANEL_WIDTH_KEY, String(serverPanelWidth.value));
};

const saveServerPanelCollapsed = () => {
  localStorage.setItem(LS_SERVER_PANEL_COLLAPSED_KEY, String(isServerPanelCollapsed.value));
};

const notifyServerPanelCollapsed = () => {
  window.dispatchEvent(new CustomEvent(SERVER_PANEL_COLLAPSED_EVENT, {
    detail: { collapsed: isServerPanelCollapsed.value },
  }));
};

const collapseServerPanel = () => {
  if (isServerPanelCollapsed.value) return;
  isServerPanelCollapsed.value = true;
  closeServerContextMenu();
  closeServerActionMenu();
  cancelRenameFolder();
  saveServerPanelCollapsed();
  notifyServerPanelCollapsed();
};

const expandServerPanel = () => {
  if (!isServerPanelCollapsed.value) return;
  isServerPanelCollapsed.value = false;
  saveServerPanelCollapsed();
  notifyServerPanelCollapsed();
};

const toggleServerPanel = () => {
  if (isServerPanelCollapsed.value) {
    expandServerPanel();
    if (serverPanelWidth.value < SERVER_PANEL_MIN_WIDTH) {
      serverPanelWidth.value = SERVER_PANEL_DEFAULT_WIDTH;
      saveServerPanelWidth();
    }
  } else {
    collapseServerPanel();
  }
};

const handleServerPanelToggleRequest = () => {
  toggleServerPanel();
};

const handleServerPanelViewportResize = () => {
  if (window.innerWidth <= SERVER_PANEL_AUTO_COLLAPSE_WIDTH && !isServerPanelCollapsed.value) {
    collapseServerPanel();
  }
  if (isTagFilterOpen.value) {
    updateTagFilterMenuPosition();
  }
};

const applyPendingServerPanelWidth = () => {
  serverPanelResizeFrameId = null;
  if (pendingServerPanelWidth === null) return;

  serverPanelWidth.value = pendingServerPanelWidth;
  pendingServerPanelWidth = null;
};

const scheduleServerPanelWidth = (width: number) => {
  pendingServerPanelWidth = clampServerPanelWidth(width);
  if (serverPanelResizeFrameId !== null) return;

  serverPanelResizeFrameId = window.requestAnimationFrame(applyPendingServerPanelWidth);
};

const flushPendingServerPanelWidth = () => {
  if (serverPanelResizeFrameId !== null) {
    window.cancelAnimationFrame(serverPanelResizeFrameId);
    serverPanelResizeFrameId = null;
  }
  applyPendingServerPanelWidth();
};

const cancelPendingServerPanelWidth = () => {
  if (serverPanelResizeFrameId !== null) {
    window.cancelAnimationFrame(serverPanelResizeFrameId);
    serverPanelResizeFrameId = null;
  }
  pendingServerPanelWidth = null;
};

const handleServerPanelResize = (event: PointerEvent) => {
  event.preventDefault();
  const nextWidth = event.clientX - serverPanelResizeOriginLeft.value;

  if (nextWidth <= SERVER_PANEL_COLLAPSE_THRESHOLD) {
    pendingServerPanelWidth = null;
    collapseServerPanel();
    stopServerPanelResize();
    return;
  }

  if (isServerPanelCollapsed.value) {
    expandServerPanel();
  }
  scheduleServerPanelWidth(nextWidth);
};

const stopServerPanelResize = () => {
  if (!isServerPanelResizing.value) return;

  isServerPanelResizing.value = false;
  flushPendingServerPanelWidth();
  window.removeEventListener('pointermove', handleServerPanelResize);
  window.removeEventListener('pointerup', stopServerPanelResize);
  releaseServerPanelResizeGuard?.();
  releaseServerPanelResizeGuard = null;
  emitWorkspaceEvent('ui:resizeTransaction', { phase: 'end', source: 'server-panel' });
  serverPanelResizeOriginLeft.value = 0;
  if (!isServerPanelCollapsed.value) {
    saveServerPanelWidth();
  }
  saveServerPanelCollapsed();
};

const startServerPanelResize = (event: PointerEvent) => {
  event.preventDefault();
  event.stopPropagation();
  closeServerContextMenu();

  if (isServerPanelCollapsed.value) {
    expandServerPanel();
    serverPanelWidth.value = SERVER_PANEL_DEFAULT_WIDTH;
    saveServerPanelWidth();
    return;
  }

  isServerPanelResizing.value = true;
  serverPanelResizeOriginLeft.value = serverListPanelRef.value?.getBoundingClientRect().left ?? 0;
  releaseServerPanelResizeGuard = beginGlobalDragSelectionGuard('col-resize');
  emitWorkspaceEvent('ui:resizeTransaction', { phase: 'start', source: 'server-panel' });
  window.addEventListener('pointermove', handleServerPanelResize);
  window.addEventListener('pointerup', stopServerPanelResize);
};

const handleCollapsedServerPanelMouseDown = (event: MouseEvent) => {
  if (!isServerPanelCollapsed.value) return;

  event.preventDefault();
  expandServerPanel();
  serverPanelWidth.value = SERVER_PANEL_DEFAULT_WIDTH;
  saveServerPanelWidth();
};

const resetServerPanelWidth = () => {
  expandServerPanel();
  serverPanelWidth.value = SERVER_PANEL_DEFAULT_WIDTH;
  saveServerPanelWidth();
};

const closeServerContextMenu = () => {
  serverContextMenu.value.visible = false;
};

const handleServerContextMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeServerContextMenu();
    closeTagFilterMenu();
    closeServerActionMenu();
  }
};

const handleDocumentClick = (event: MouseEvent) => {
  closeServerContextMenu();

  const target = event.target as Node | null;
  if (
    target
    && (serverActionButtonRef.value?.contains(target) || serverActionMenuRef.value?.contains(target))
  ) {
    return;
  }
  closeServerActionMenu();

  if (
    target
    && (tagFilterButtonRef.value?.contains(target) || tagFilterMenuRef.value?.contains(target))
  ) {
    return;
  }
  closeTagFilterMenu();
};

const showServerContextMenu = (
  event: MouseEvent,
  targetFolderId: number | null = null,
  targetType: 'root' | 'folder' | 'connection' = 'root',
  targetConnectionId: number | null = null,
) => {
  const menuWidth = 210;
  const menuHeight = targetType === 'connection' ? 220 : 132;
  serverContextMenu.value = {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
    y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
    targetFolderId,
    targetType,
    targetConnectionId,
  };
};

const serverConnectionLongPressHandlers = new Map<string, MobileLongPressHandlers>();
const getServerConnectionLongPressHandlers = (
  folderId: number | null,
  connectionId: number,
) => {
  const handlerKey = `${folderId ?? 'root'}:${connectionId}`;
  const cachedHandlers = serverConnectionLongPressHandlers.get(handlerKey);
  if (cachedHandlers) return cachedHandlers;

  const handlers = createMobileLongPressHandlers({
    isMobile,
    onLongPress: (event, point) => {
      showServerContextMenu(createLongPressContextMenuEvent(event, point), folderId, 'connection', connectionId);
    },
  });
  serverConnectionLongPressHandlers.set(handlerKey, handlers);
  return handlers;
};

const serverFolderLongPressHandlers = new Map<number, MobileLongPressHandlers>();
const getServerFolderLongPressHandlers = (folderId: number) => {
  const cachedHandlers = serverFolderLongPressHandlers.get(folderId);
  if (cachedHandlers) return cachedHandlers;

  const handlers = createMobileLongPressHandlers({
    isMobile,
    onLongPress: (event, point) => {
      showServerContextMenu(createLongPressContextMenuEvent(event, point), folderId, 'folder');
    },
  });
  serverFolderLongPressHandlers.set(folderId, handlers);
  return handlers;
};

const serverListBodyLongPressHandlers = createMobileLongPressHandlers({
  isMobile,
  onLongPress: (event, point) => {
    showServerContextMenu(createLongPressContextMenuEvent(event, point));
  },
});

const contextTargetConnection = computed(() => {
  const targetConnectionId = serverContextMenu.value.targetConnectionId;
  if (targetConnectionId === null) return null;
  return connections.value.find(conn => conn.id === targetConnectionId) ?? null;
});

const handleAddConnectionFromContext = () => {
  const folderId = serverContextMenu.value.targetFolderId;
  closeServerContextMenu();
  openAddConnectionForm(folderId);
};

const handleTestConnectionFromContext = () => {
  const conn = contextTargetConnection.value;
  closeServerContextMenu();
  if (!conn) return;
  handleTestSingleConnection(conn);
};

const handleEditConnectionFromContext = () => {
  const conn = contextTargetConnection.value;
  closeServerContextMenu();
  if (!conn) return;
  openEditConnectionForm(conn);
};

const handleDeleteConnectionFromContext = async () => {
  const conn = contextTargetConnection.value;
  closeServerContextMenu();
  if (!conn) return;

  const confirmed = await showConfirmDialog({
    title: t('connections.actions.delete', '删除'),
    message: t(
      'connections.prompts.confirmDelete',
      { name: conn.name || conn.host },
      `确定要删除连接 "${conn.name || conn.host}" 吗？此操作不可撤销。`
    ),
    confirmText: t('common.delete', '删除'),
    cancelText: t('common.cancel', '取消'),
  });
  if (!confirmed) return;

  const success = await connectionsStore.deleteConnection(conn.id);
  if (!success) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: t('connections.errors.deleteFailed', { error: connectionsStore.error || t('common.unknownError', '未知错误') }),
    });
    return;
  }

  await connectionsStore.fetchConnections();
};

const getNextFolderName = () => {
  const baseName = t('connections.folders.newFolderDefaultName', '新建文件夹');
  const usedNames = new Set(folders.value.map(folder => folder.name.toLowerCase()));
  if (!usedNames.has(baseName.toLowerCase())) return baseName;

  let index = 2;
  let nextName = `${baseName} ${index}`;
  while (usedNames.has(nextName.toLowerCase())) {
    index += 1;
    nextName = `${baseName} ${index}`;
  }

  return nextName;
};

const handleCreateFolderFromContext = async () => {
  const parentFolderId = serverContextMenu.value.targetType === 'folder'
    ? serverContextMenu.value.targetFolderId
    : null;
  closeServerContextMenu();
  selectedFolderId.value = null;
  searchQuery.value = '';
  const folderName = getNextFolderName();
  const newFolder = await connectionsStore.addFolder(folderName, parentFolderId);
  if (!newFolder) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: t('connections.folders.createFailed', { name: folderName, error: connectionsStore.error || t('common.unknownError', '未知错误') }),
    });
    return;
  }

  if (parentFolderId !== null) {
    expandedServerFolders.value[folderKey(parentFolderId)] = true;
  }
  expandedServerFolders.value[folderKey(newFolder.id)] = true;
  await connectionsStore.fetchFolders();
  const createdFolder = folders.value.find(folder => folder.id === newFolder.id) ?? newFolder;
  startRenameFolder({
    key: folderKey(createdFolder.id),
    folderId: createdFolder.id,
    parentId: createdFolder.parent_id ?? null,
    depth: 0,
    name: createdFolder.name,
    connections: [],
    totalConnectionCount: 0,
  });
};

const handleRenameFolderFromContext = () => {
  const folderId = serverContextMenu.value.targetFolderId;
  const folder = groupedServerFolders.value.find(group => group.folderId === folderId);
  closeServerContextMenu();
  if (!folder) return;
  startRenameFolder(folder);
};

const handleDeleteFolderFromContext = async () => {
  const folderId = serverContextMenu.value.targetFolderId;
  const folder = groupedServerFolders.value.find(group => group.folderId === folderId);
  closeServerContextMenu();

  if (!folder) return;

  const descendantFolderIds = getDescendantFolderIds(folder.folderId);
  const folderIdsToDelete = new Set([folder.folderId, ...descendantFolderIds]);
  const connectionsToDelete = connections.value.filter(conn => conn.folder_id !== null && typeof conn.folder_id !== 'undefined' && folderIdsToDelete.has(conn.folder_id));
  const connectionCount = connectionsToDelete.length;
  const confirmMessage = connectionCount > 0
    ? t(
      'connections.folders.confirmDeleteWithConnections',
      { name: folder.name, count: connectionCount },
      `文件夹 "${folder.name}" 下有 ${connectionCount} 个服务器配置，删除文件夹会同时删除这些服务器配置。是否确认？`
    )
    : t(
      'connections.folders.confirmDeleteEmpty',
      { name: folder.name },
      `确定删除文件夹 "${folder.name}" 吗？`
    );

  const confirmed = await showConfirmDialog({
    title: t('connections.folders.deleteFolder', '删除文件夹'),
    message: confirmMessage,
    confirmText: t('common.delete', '删除'),
    cancelText: t('common.cancel', '取消'),
  });
  if (!confirmed) return;

  if (connectionCount > 0) {
    const success = await connectionsStore.deleteBatchConnections(connectionsToDelete.map(conn => conn.id));
    if (!success) {
      showAlertDialog({
        title: t('common.error', '错误'),
        message: t('connections.folders.deleteConnectionsFailed', { name: folder.name, error: connectionsStore.error || t('common.unknownError', '未知错误') }),
      });
      await connectionsStore.fetchConnections();
      return;
    }
  }

  for (const nestedFolderId of Array.from(descendantFolderIds).reverse()) {
    const nestedDeleted = await connectionsStore.deleteFolder(nestedFolderId);
    if (!nestedDeleted) {
      showAlertDialog({
        title: t('common.error', '错误'),
        message: t('connections.folders.deleteFailed', { name: folder.name, error: connectionsStore.error || t('common.unknownError', '未知错误') }),
      });
      return;
    }
  }

  const folderDeleted = await connectionsStore.deleteFolder(folder.folderId);
  if (!folderDeleted) {
    showAlertDialog({
      title: t('common.error', '错误'),
      message: t('connections.folders.deleteFailed', { name: folder.name, error: connectionsStore.error || t('common.unknownError', '未知错误') }),
    });
    return;
  }

  if (selectedFolderId.value !== null && folderIdsToDelete.has(selectedFolderId.value)) {
    selectedFolderId.value = null;
  }
  await Promise.all([
    connectionsStore.fetchConnections(),
    connectionsStore.fetchFolders(),
  ]);
};

// --- Batch Edit Functions ---
const toggleBatchEditMode = () => {
  isBatchEditMode.value = !isBatchEditMode.value;
  if (!isBatchEditMode.value) {
    selectedConnectionIdsForBatch.value.clear(); // Clear selection when exiting batch mode
  }
};

const handleConnectionClick = (connId: number) => {
  if (!isBatchEditMode.value) return;
  if (selectedConnectionIdsForBatch.value.has(connId)) {
    selectedConnectionIdsForBatch.value.delete(connId);
  } else {
    selectedConnectionIdsForBatch.value.add(connId);
  }
};

const isConnectionSelectedForBatch = (connId: number): boolean => {
  return selectedConnectionIdsForBatch.value.has(connId);
};

const selectAllConnections = () => {
  if (!isBatchEditMode.value) return;
  filteredAndSortedConnections.value.forEach(conn => selectedConnectionIdsForBatch.value.add(conn.id));
};

const deselectAllConnections = () => {
  if (!isBatchEditMode.value) return;
  selectedConnectionIdsForBatch.value.clear();
};

const invertSelection = () => {
  if (!isBatchEditMode.value) return;
  const allVisibleIds = new Set(filteredAndSortedConnections.value.map(conn => conn.id));
  allVisibleIds.forEach(id => {
    if (selectedConnectionIdsForBatch.value.has(id)) {
      selectedConnectionIdsForBatch.value.delete(id);
    } else {
      selectedConnectionIdsForBatch.value.add(id);
    }
  });
};

const openBatchEditModal = () => {
  if (selectedConnectionIdsForBatch.value.size === 0) {
    // Optionally, show a notification from uiNotificationsStore using your project's method
    showAlertDialog({ title: t('common.alert', '提示'), message: t('connections.batchEdit.noSelectionForEdit', '请至少选择一个连接进行编辑。') }); // Placeholder
    return;
  }
  showBatchEditForm.value = true;
};

const handleBatchEditSaved = async () => {
  showBatchEditForm.value = false;
  selectedConnectionIdsForBatch.value.clear();
  // isBatchEditMode.value = false; // Optionally exit batch mode after saving
  await connectionsStore.fetchConnections(); // Refresh the list
};

const handleBatchEditFormClose = () => {
  showBatchEditForm.value = false;
};

// --- 批量删除 ---
const handleBatchDeleteConnections = async () => {
  if (selectedConnectionIdsForBatch.value.size === 0 || isDeletingSelectedConnections.value) {
    return;
  }

  const confirmMessage = t(
    'connections.batchEdit.confirmMessage',
    { count: selectedConnectionIdsForBatch.value.size },
    `您确定要删除选中的 ${selectedConnectionIdsForBatch.value.size} 个连接吗？此操作无法撤销。`
  );


  const confirmed = await showConfirmDialog({
    message: confirmMessage
  });
  if (confirmed) {
    isDeletingSelectedConnections.value = true;
    try {
      const idsToDelete = Array.from(selectedConnectionIdsForBatch.value);
      await connectionsStore.deleteBatchConnections(idsToDelete);


      showAlertDialog({ title: t('common.success', '成功'), message: t('connections.batchEdit.successMessage', '选中的连接已成功删除。') });

      selectedConnectionIdsForBatch.value.clear();

      await connectionsStore.fetchConnections();
    } catch (error: any) {
      console.error("Batch delete connections error:", error);
      showAlertDialog({ title: t('common.error'), message: t('connections.batchEdit.errorMessage', `批量删除连接失败: ${error.message || '未知错误'}`) });
    } finally {
      isDeletingSelectedConnections.value = false;
    }
  }
};

// --- Test Connection Logic ---
interface ConnectionTestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  resultText: string;
  latency?: number;
  latencyColor?: string;
}
const connectionTestStates = ref<Map<number, ConnectionTestState>>(new Map());
const isTestingAll = ref(false);
const isConnectionTestSupported = (type: ConnectionInfo['type']) => ['SSH', 'TELNET', 'RDP', 'VNC'].includes(type);
const CONNECTION_TEST_RESULT_VISIBLE_MS = 8000;
const connectionTestHideTimers = new Map<number, ReturnType<typeof setTimeout>>();

const clearConnectionTestHideTimer = (connectionId: number) => {
  const timer = connectionTestHideTimers.get(connectionId);
  if (!timer) return;

  clearTimeout(timer);
  connectionTestHideTimers.delete(connectionId);
};

const scheduleConnectionTestStateAutoHide = (connectionId: number) => {
  clearConnectionTestHideTimer(connectionId);
  const timer = setTimeout(() => {
    connectionTestHideTimers.delete(connectionId);
    connectionTestStates.value.delete(connectionId);
    connectionTestStates.value = new Map(connectionTestStates.value);
  }, CONNECTION_TEST_RESULT_VISIBLE_MS);
  connectionTestHideTimers.set(connectionId, timer);
};

const getLatencyColorString = (latencyMs?: number): string => {
  if (latencyMs === undefined) return 'inherit'; // Default or inherit
  // These colors should ideally come from theme variables if available
  if (latencyMs < 100) return 'var(--color-success, #4CAF50)';
  if (latencyMs < 300) return 'var(--color-warning, #ff9800)';
  return 'var(--color-error, #F44336)';
};

const handleTestSingleConnection = async (conn: ConnectionInfo) => {
  if (!conn.id || !isConnectionTestSupported(conn.type)) return;

  clearConnectionTestHideTimer(conn.id);
  connectionTestStates.value.set(conn.id, {
    status: 'testing',
    resultText: t('connections.test.testingInProgress', '测试中...'),
  });

  try {
    // Pass only the ID to testConnection, as per store definition
    const result = await connectionsStore.testConnection(conn.id);

    if (result.success) {
      const latencyMs = result.latency;
      let displayText = ''; // 初始化为空字符串，符合只显示延迟的要求
      let determinedColor;

      if (latencyMs !== undefined) {
        displayText = `${latencyMs}ms`;
        determinedColor = getLatencyColorString(latencyMs);
      } else {
        // 测试成功，但没有延迟信息。不显示文本。
        // 颜色应为明确的成功颜色。
        // getLatencyColorString(0) 会返回绿色，代表非常好的情况。
        determinedColor = getLatencyColorString(0); // 或者直接使用 'var(--color-success, #4CAF50)'
      }

      connectionTestStates.value.set(conn.id, {
        status: 'success',
        resultText: displayText, // 将显示 "XXms" 或者为空
        latency: latencyMs,
        latencyColor: determinedColor,
      });
      scheduleConnectionTestStateAutoHide(conn.id);
    } else {
      connectionTestStates.value.set(conn.id, {
        status: 'error',
        resultText: result.message || t('connections.test.unknownError', '未知错误'),
      });
      scheduleConnectionTestStateAutoHide(conn.id);
    }
  } catch (error: any) {
    connectionTestStates.value.set(conn.id, {
      status: 'error',
      resultText: error.message || t('connections.test.unknownError', '未知错误'),
    });
    scheduleConnectionTestStateAutoHide(conn.id);
  }
};

const handleTestAllFilteredConnections = async () => {
  if (isTestingAll.value || isLoadingConnections.value) return;
  const connectionsToTest = filteredAndSortedConnections.value.filter(c => isConnectionTestSupported(c.type) && c.id != null);
  if (connectionsToTest.length === 0) {
    return;
  }

  isTestingAll.value = true;
  const testPromises = connectionsToTest.map(conn => {
    // conn.id is guaranteed to exist here due to the filter above.
    // We're calling handleTestSingleConnection for each.
    // Individual errors within handleTestSingleConnection will update that specific connection's state.
    // We also add a .catch here to handle any unexpected errors from handleTestSingleConnection itself
    // or if conn.id was somehow null/undefined (though filtered out).
    return handleTestSingleConnection(conn).catch(error => {
      console.error(`Error testing connection ${conn.id}:`, error);
      // Ensure state is updated for this specific connection to show an error
      // The 'id' here is from the 'conn' object in the map function's scope.
      connectionTestStates.value.set(conn.id!, { // Using non-null assertion as id is checked
        status: 'error',
        resultText: t('connections.test.unknownErrorDuringBatch', '批量测试中发生错误'), // New i18n key
      });
    });
  });

  try {
    await Promise.all(testPromises);
  } catch (error) {
    // This catch block handles errors if Promise.all itself fails,
    // though individual promise rejections are handled above.
    console.error("Error during batch testing of connections (Promise.all):", error);
    // Optionally, set a general error state or notification for the entire batch operation if needed.
  } finally {
    isTestingAll.value = false;
  }
};

const getSingleTestButtonInfo = (connId: number | undefined, connType: string | undefined) => {
  const state = connId ? connectionTestStates.value.get(connId) : undefined;

  if (connType !== 'SSH') {
    return {
      textKey: 'connections.actions.test',
      iconClass: 'fas fa-plug',
      disabled: true,
      loading: false,
      title: t('connections.test.onlySshSupportedTest', '仅SSH连接支持测试。')
    };
  }
  if (!connId) { // Should not happen if connType is SSH and we are in the list
     return { textKey: 'connections.actions.test', iconClass: 'fas fa-plug', disabled: true, loading: false, title: '' };
  }

  if (state?.status === 'testing') {
    return { textKey: 'connections.actions.testing', iconClass: 'fas fa-spinner fa-spin', disabled: true, loading: true, title: t('connections.actions.testing', '测试中') };
  }
  if (state?.status === 'success' || state?.status === 'error') {
    // 测试完成后，按钮恢复为初始“测试”状态
    return { textKey: 'connections.actions.test', iconClass: 'fas fa-plug', disabled: false, loading: false, title: t('connections.actions.test', '测试') };
  }
  // 默认状态也是“测试”
  return { textKey: 'connections.actions.test', iconClass: 'fas fa-plug', disabled: false, loading: false, title: t('connections.actions.test', '测试') };
};

const getTruncatedNotes = (notes: string | null | undefined): string => {
  if (!notes || notes.trim() === '') return ''; // 返回空字符串，如果没有备注
  const maxLength = 100;
  if (notes.length <= maxLength) return notes;
  return notes.substring(0, maxLength) + '...';
};

const formatServerDetailValue = (value: string | number | null | undefined): string => {
  const text = value === null || typeof value === 'undefined' ? '' : String(value).trim();
  return text || '-';
};

const getServerDetailRows = (connection: ConnectionInfo) => [
  {
    key: 'username',
    label: t('connections.form.username', '用户名:'),
    value: formatServerDetailValue(connection.username),
  },
  {
    key: 'host',
    label: t('connections.form.host', '主机/IP:'),
    value: formatServerDetailValue(connection.host),
  },
  {
    key: 'port',
    label: t('connections.form.port', '端口:'),
    value: formatServerDetailValue(connection.port),
  },
];

const getServerDetailTitle = (connection: ConnectionInfo): string => {
  const username = formatServerDetailValue(connection.username);
  const host = formatServerDetailValue(connection.host);
  const port = formatServerDetailValue(connection.port);
  return `${username}@${host}:${port}`;
};

const serverEntryMetaById = computed(() => {
  const metaMap = new Map<number, ServerEntryMeta>();
  manualOrderedFilteredConnections.value.forEach((connection) => {
    metaMap.set(connection.id, {
      tagNames: getTagNames(connection.tag_ids),
      detailRows: getServerDetailRows(connection),
      detailTitle: getServerDetailTitle(connection),
      truncatedNotes: getTruncatedNotes(connection.notes),
    });
  });
  return metaMap;
});

const getServerEntryMeta = (connection: ConnectionInfo): ServerEntryMeta => (
  serverEntryMetaById.value.get(connection.id) ?? {
    tagNames: [],
    detailRows: getServerDetailRows(connection),
    detailTitle: getServerDetailTitle(connection),
    truncatedNotes: getTruncatedNotes(connection.notes),
  }
);



// --- Connect All Filtered Connections ---
const isConnectingAll = ref(false);
const isOpeningAll = ref(false);

const handleConnectAllFilteredConnections = async () => {
  if (isConnectingAll.value || isLoadingConnections.value) return;

  const sshConnectionsToConnect = commandTargetSshConnections.value;
  if (sshConnectionsToConnect.length === 0) {
    console.warn(
      isBatchEditMode.value
        ? t('connections.messages.noSelectedSshConnectionsToConnect', '没有选中的 SSH 连接。')
        : t('connections.messages.noSshConnectionsToConnectAll', '没有可连接的 SSH 筛选结果。')
    );
    // Optionally, use a UI notification if available in your project
    // e.g., uiNotificationsStore.addNotification({ message: t('connections.messages.noSshConnectionsToConnectAll'), type: 'info' });
    return;
  }

  isConnectingAll.value = true;
  try {
    for (const conn of sshConnectionsToConnect) {
      connectTo(conn);
      // Consider a small delay if you want to visually see connections initiating one by one,
      // or if connectTo triggers operations that might benefit from not being fired too rapidly.
      // await new Promise(resolve => setTimeout(resolve, 200)); // Example delay
    }
  } catch (error) {
    console.error("Error connecting to all filtered SSH connections:", error);
    // uiNotificationsStore.addNotification({ message: t('connections.errors.connectAllSshFailed', '连接全部 SSH 操作失败。'), type: 'error' });
  } finally {
    isConnectingAll.value = false;
  }
};

const handleOpenAllTargetConnections = async () => {
  if (isOpeningAll.value || isLoadingConnections.value) return;

  const connectionsToOpen = commandTargetConnections.value;
  if (connectionsToOpen.length === 0) {
    console.warn(
      isBatchEditMode.value
        ? t('connections.messages.noSelectedConnectionsToOpen', '没有选中的连接。')
        : t('connections.messages.noConnectionsToOpen', '没有可打开的连接。')
    );
    return;
  }

  isOpeningAll.value = true;
  try {
    for (const conn of connectionsToOpen) {
      connectTo(conn);
    }
  } catch (error) {
    console.error("Error opening all target connections:", error);
  } finally {
    isOpeningAll.value = false;
  }
};

</script>

<template>
  <div class="connections-page">
    <div class="connections-layout">
      <section
        ref="serverListPanelRef"
        class="server-list-panel"
        :class="{ 'is-resizing': isServerPanelResizing, 'is-collapsed': isServerPanelCollapsed }"
        :style="serverListPanelStyle"
        :aria-label="t('nav.connections', '服务器')"
        @mousedown="handleCollapsedServerPanelMouseDown"
      >
        <div v-if="!isServerPanelCollapsed" class="server-list-inner" @contextmenu.prevent="showServerContextMenu($event)">
          <div class="server-search-row">
            <div class="server-search-box">
              <i class="fas fa-search"></i>
              <input
                type="text"
                v-model="searchQuery"
                :placeholder="t('dashboard.searchConnectionsPlaceholder', '搜索连接...')"
              />
            </div>
          </div>

          <div class="server-filter-row">
            <select
              v-model="selectedFolderId"
              class="server-select"
              :aria-label="t('connections.folders.filterByFolder', '按文件夹筛选')"
              :disabled="isFoldersLoading"
            >
              <option :value="null">{{ t('connections.folders.allFolders', '所有文件夹') }}</option>
              <option v-if="isFoldersLoading" disabled>{{ t('common.loading') }}</option>
              <option v-for="folder in folderFilterOptions" :key="folder.id" :value="folder.id">
                {{ folder.label }}
              </option>
            </select>

            <div class="server-tag-filter">
              <button
                ref="tagFilterButtonRef"
                type="button"
                class="server-icon-button server-tag-filter-button"
                :class="{ active: selectedTagCount > 0 }"
                @click.stop="toggleTagFilterMenu"
                :aria-label="t('connections.folders.filterByTags', '按标签筛选')"
                :title="t('connections.folders.filterByTags', '按标签筛选')"
              >
                <i class="fas fa-tag"></i>
                <span v-if="selectedTagCount > 0" class="server-tag-filter-count">{{ selectedTagCount }}</span>
              </button>
            </div>
            <button
              type="button"
              class="server-icon-button server-add-button"
              :aria-label="t('connections.addConnection', '添加新连接')"
              :title="t('connections.addConnection', '添加新连接')"
              @click="openAddConnectionForm()"
            >
              <i class="fas fa-plus"></i>
            </button>
          </div>

          <div class="server-command-row">
            <div class="server-batch-toggle">
              <span>{{ t('connections.batchEdit.toggleLabel', '批量操作') }}</span>
              <button
                id="batch-edit-toggle"
                type="button"
                class="server-switch"
                :class="{ active: isBatchEditMode }"
                role="switch"
                :aria-checked="isBatchEditMode"
                @click="toggleBatchEditMode"
              >
                <span></span>
              </button>
            </div>

            <div class="server-command-actions">
              <button
                  type="button"
                  class="server-icon-button"
                  @click="handleConnectAllFilteredConnections"
                  :disabled="isConnectingAll || isLoadingConnections || commandTargetSshConnections.length === 0"
                  :aria-label="connectAllActionTitle"
                  :title="connectAllActionTitle"
              >
                <i v-if="isConnectingAll" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-network-wired"></i>
              </button>
              <button
                type="button"
                class="server-icon-button"
                @click="handleOpenAllTargetConnections"
                :disabled="isOpeningAll || isLoadingConnections || commandTargetConnections.length === 0"
                :aria-label="openAllActionTitle"
                :title="openAllActionTitle"
              >
                <i v-if="isOpeningAll" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-external-link-alt"></i>
              </button>
              <button
                type="button"
                class="server-icon-button"
                @click="handleTestAllFilteredConnections"
                :disabled="isTestingAll || isLoadingConnections || !filteredAndSortedConnections.some(c => c.type === 'SSH')"
                :aria-label="t('connections.actions.testAllFiltered', '测试全部筛选的SSH连接')"
                :title="t('connections.actions.testAllFiltered', '测试全部筛选的SSH连接')"
              >
                <i v-if="isTestingAll" class="fas fa-spinner fa-spin"></i>
                <i v-else class="fas fa-check-double"></i>
              </button>
            </div>
          </div>

          <div v-if="isBatchEditMode" class="server-batch-bar">
            <button type="button" @click="selectAllConnections">
              {{ t('connections.batchEdit.selectAll', '全选') }} ({{ selectedConnectionIdsForBatch.size }})
            </button>
            <button type="button" @click="deselectAllConnections">
              {{ t('connections.batchEdit.deselectAll', '取消全选') }}
            </button>
            <button type="button" @click="invertSelection">
              {{ t('connections.batchEdit.invertSelection', '反选') }}
            </button>
            <button type="button" :disabled="selectedConnectionIdsForBatch.size === 0" @click="openBatchEditModal">
              <i class="fas fa-edit"></i>
              {{ t('connections.batchEdit.editSelected', '编辑选中') }}
            </button>
            <button
              type="button"
              class="danger"
              :disabled="selectedConnectionIdsForBatch.size === 0 || isDeletingSelectedConnections"
              :title="t('connections.batchEdit.deleteSelectedTooltip', '删除选中的连接')"
              @click="handleBatchDeleteConnections"
            >
              <i v-if="isDeletingSelectedConnections" class="fas fa-spinner fa-spin"></i>
              <i v-else class="fas fa-trash-alt"></i>
              {{ t('connections.batchEdit.deleteSelectedButton', '删除选中') }}
            </button>
          </div>

          <div
            class="server-list-body"
            @contextmenu.prevent.stop="showServerContextMenu($event)"
            @touchstart="serverListBodyLongPressHandlers.onTouchstart"
            @touchmove="serverListBodyLongPressHandlers.onTouchmove"
            @touchend="serverListBodyLongPressHandlers.onTouchend"
            @touchcancel="serverListBodyLongPressHandlers.onTouchcancel"
            @click.capture="serverListBodyLongPressHandlers.onClickCapture"
          >
            <div v-if="isLoadingConnections && filteredAndSortedConnections.length === 0" class="server-state">
              <i class="fas fa-spinner fa-spin"></i>
              <span>{{ t('common.loading') }}</span>
            </div>

            <div v-else-if="hasVisibleServerTreeItems" class="server-folder-tree">
              <draggable
                :list="unfiledServerEntries"
                item-key="id"
                group="server-connections"
                class="server-entries server-entries-root"
                tag="ul"
                :disabled="!canPersistManualOrder || isBatchEditMode"
                :data-folder-id="''"
                handle=".server-entry"
                ghost-class="server-drag-ghost"
                chosen-class="server-drag-chosen"
                @start="handleConnectionDragStart"
                @end="handleConnectionDragEnd"
              >
                <template #item="{ element: conn }">
                  <li
                    :data-connection-id="conn.id"
                    :class="[
                      'server-entry',
                      {
                        'server-entry-batch': isBatchEditMode,
                        'server-entry-selected': isBatchEditMode && isConnectionSelectedForBatch(conn.id)
                      }
                    ]"
                    @click="handleConnectionClick(conn.id)"
                    @dblclick="!isBatchEditMode && connectTo(conn)"
                    @contextmenu.prevent.stop="showServerContextMenu($event, null, 'connection', conn.id)"
                    @touchstart.stop="getServerConnectionLongPressHandlers(null, conn.id).onTouchstart"
                    @touchmove.stop="getServerConnectionLongPressHandlers(null, conn.id).onTouchmove"
                    @touchend.stop="getServerConnectionLongPressHandlers(null, conn.id).onTouchend"
                    @touchcancel.stop="getServerConnectionLongPressHandlers(null, conn.id).onTouchcancel"
                    @click.capture="getServerConnectionLongPressHandlers(null, conn.id).onClickCapture"
                  >
                    <div class="server-entry-icon">
                      <ServerIcon :icon="conn.icon" :type="conn.type" />
                    </div>

                    <div class="server-entry-content">
                      <div class="server-entry-mainline">
                        <span class="server-entry-name" :title="getServerEntryMeta(conn).detailTitle">
                          {{ conn.name || t('connections.unnamedFallback', '未命名连接') }}
                        </span>
                        <span class="server-entry-type">{{ conn.type }}</span>
                        <div v-if="getServerEntryMeta(conn).tagNames.length > 0" class="server-entry-tags">
                          <span v-for="tagName in getServerEntryMeta(conn).tagNames" :key="tagName">
                            {{ tagName }}
                          </span>
                        </div>
                      </div>
                      <div class="server-entry-detail-popover" role="tooltip">
                        <div v-for="row in getServerEntryMeta(conn).detailRows" :key="row.key" class="server-entry-detail-row">
                          <span class="server-entry-detail-label">{{ row.label }}</span>
                          <span class="server-entry-detail-value">{{ row.value }}</span>
                        </div>
                      </div>
                      <div v-if="conn.notes && conn.notes.trim() !== ''" class="server-entry-meta">
                        <span :title="conn.notes">
                          {{ getServerEntryMeta(conn).truncatedNotes }}
                        </span>
                      </div>
                      <div
                        v-if="isConnectionTestSupported(conn.type) && connectionTestStates.get(conn.id) && connectionTestStates.get(conn.id)?.status !== 'idle'"
                        class="server-test-result"
                        :class="`server-test-result-${connectionTestStates.get(conn.id)?.status}`"
                        :style="connectionTestStates.get(conn.id)?.status === 'success' ? { color: connectionTestStates.get(conn.id)?.latencyColor || 'inherit' } : undefined"
                      >
                        <template v-if="connectionTestStates.get(conn.id)?.status === 'testing'">
                          <i class="fas fa-spinner fa-spin"></i>
                          {{ t('connections.test.testingInProgress', '测试中...') }}
                        </template>
                        <template v-else-if="connectionTestStates.get(conn.id)?.status === 'success'">
                          <i class="fas fa-check-circle"></i>
                          {{ connectionTestStates.get(conn.id)?.resultText }}
                        </template>
                        <template v-else-if="connectionTestStates.get(conn.id)?.status === 'error'">
                          <i class="fas fa-times-circle"></i>
                          {{ t('connections.test.errorPrefix', '错误:') }} {{ connectionTestStates.get(conn.id)?.resultText }}
                        </template>
                      </div>
                    </div>
                  </li>
                </template>
              </draggable>

              <div
                class="server-folder-drag-list"
                :class="{ 'server-folder-root-drop': isFolderDropTarget(null, 'inside') }"
                @dragover="handleRootFolderDragOver"
                @drop="handleRootFolderDrop"
              >
                <template v-for="folder in groupedServerFolders" :key="folder.key">
              <div
                class="server-folder"
                :data-folder-id="folder.folderId"
                :data-folder-depth="folder.depth"
              >
                <div
                  :class="[
                    'server-folder-header',
                    {
                      'folder-drop-before': isFolderDropTarget(folder.folderId, 'before'),
                      'folder-drop-after': isFolderDropTarget(folder.folderId, 'after'),
                      'folder-drop-inside': isFolderDropTarget(folder.folderId, 'inside'),
                      'folder-dragging': draggingFolderId === folder.folderId,
                    }
                  ]"
                  :style="{ paddingLeft: `${0.45 + folder.depth * 1.05}rem` }"
                  role="button"
                  tabindex="0"
                  :draggable="canPersistManualOrder && !isBatchEditMode"
                  @click="toggleFolder(folder.folderId)"
                  @keydown.enter.prevent="toggleFolder(folder.folderId)"
                  @keydown.space.prevent="toggleFolder(folder.folderId)"
                  @dragstart="handleFolderDragStart($event, folder.folderId)"
                  @dragover="handleFolderDragOver($event, folder)"
                  @drop="handleFolderDrop($event, folder)"
                  @dragend="handleFolderDragEnd"
                  @dragenter="handleFolderDragEnter(folder.folderId)"
                  @contextmenu.prevent.stop="showServerContextMenu($event, folder.folderId, 'folder')"
                  @touchstart.stop="getServerFolderLongPressHandlers(folder.folderId).onTouchstart"
                  @touchmove.stop="getServerFolderLongPressHandlers(folder.folderId).onTouchmove"
                  @touchend.stop="getServerFolderLongPressHandlers(folder.folderId).onTouchend"
                  @touchcancel.stop="getServerFolderLongPressHandlers(folder.folderId).onTouchcancel"
                  @click.capture="getServerFolderLongPressHandlers(folder.folderId).onClickCapture"
                >
                  <i :class="['fas', isFolderExpanded(folder.folderId) ? 'fa-chevron-down' : 'fa-chevron-right']"></i>
                  <input
                    v-if="editingFolderId === folder.folderId"
                    :ref="setFolderRenameInputRef"
                    v-model="editingFolderName"
                    class="server-folder-name-input"
                    :disabled="isSavingFolderRename"
                    :aria-label="t('connections.folders.renameFolder', '重命名文件夹')"
                    @click.stop
                    @keydown.enter.prevent.stop="submitFolderRename(folder)"
                    @keydown.esc.prevent.stop="cancelRenameFolder"
                    @blur="submitFolderRename(folder)"
                  >
                  <span v-else class="server-folder-name" :title="folder.name">{{ folder.name }}</span>
                  <span class="server-folder-count">{{ folder.totalConnectionCount }}</span>
                </div>

                <draggable
                  v-show="isFolderExpanded(folder.folderId)"
                  :list="folder.connections"
                  item-key="id"
                  group="server-connections"
                  class="server-entries"
                  tag="ul"
                  :disabled="!canPersistManualOrder || isBatchEditMode"
                  :data-folder-id="folder.folderId"
                  handle=".server-entry"
                  ghost-class="server-drag-ghost"
                  chosen-class="server-drag-chosen"
                  @start="handleConnectionDragStart"
                  @end="handleConnectionDragEnd"
                >
                  <template #item="{ element: conn }">
                  <li
                    :data-connection-id="conn.id"
                    :class="[
                      'server-entry',
                      {
                        'server-entry-batch': isBatchEditMode,
                        'server-entry-selected': isBatchEditMode && isConnectionSelectedForBatch(conn.id)
                      }
                    ]"
                    @click="handleConnectionClick(conn.id)"
                    @dblclick="!isBatchEditMode && connectTo(conn)"
                    @contextmenu.prevent.stop="showServerContextMenu($event, folder.folderId, 'connection', conn.id)"
                    @touchstart.stop="getServerConnectionLongPressHandlers(folder.folderId, conn.id).onTouchstart"
                    @touchmove.stop="getServerConnectionLongPressHandlers(folder.folderId, conn.id).onTouchmove"
                    @touchend.stop="getServerConnectionLongPressHandlers(folder.folderId, conn.id).onTouchend"
                    @touchcancel.stop="getServerConnectionLongPressHandlers(folder.folderId, conn.id).onTouchcancel"
                    @click.capture="getServerConnectionLongPressHandlers(folder.folderId, conn.id).onClickCapture"
                  >
                    <div class="server-entry-icon">
                      <ServerIcon :icon="conn.icon" :type="conn.type" />
                    </div>

                    <div class="server-entry-content">
                      <div class="server-entry-mainline">
                        <span class="server-entry-name" :title="getServerEntryMeta(conn).detailTitle">
                          {{ conn.name || t('connections.unnamedFallback', '未命名连接') }}
                        </span>
                        <span class="server-entry-type">{{ conn.type }}</span>
                        <div v-if="getServerEntryMeta(conn).tagNames.length > 0" class="server-entry-tags">
                          <span v-for="tagName in getServerEntryMeta(conn).tagNames" :key="tagName">
                            {{ tagName }}
                          </span>
                        </div>
                      </div>
                      <div class="server-entry-detail-popover" role="tooltip">
                        <div v-for="row in getServerEntryMeta(conn).detailRows" :key="row.key" class="server-entry-detail-row">
                          <span class="server-entry-detail-label">{{ row.label }}</span>
                          <span class="server-entry-detail-value">{{ row.value }}</span>
                        </div>
                      </div>
                      <div v-if="conn.notes && conn.notes.trim() !== ''" class="server-entry-meta">
                        <span :title="conn.notes">
                          {{ getServerEntryMeta(conn).truncatedNotes }}
                        </span>
                      </div>
                      <div
                        v-if="isConnectionTestSupported(conn.type) && connectionTestStates.get(conn.id) && connectionTestStates.get(conn.id)?.status !== 'idle'"
                        class="server-test-result"
                        :class="`server-test-result-${connectionTestStates.get(conn.id)?.status}`"
                        :style="connectionTestStates.get(conn.id)?.status === 'success' ? { color: connectionTestStates.get(conn.id)?.latencyColor || 'inherit' } : undefined"
                      >
                        <template v-if="connectionTestStates.get(conn.id)?.status === 'testing'">
                          <i class="fas fa-spinner fa-spin"></i>
                          {{ t('connections.test.testingInProgress', '测试中...') }}
                        </template>
                        <template v-else-if="connectionTestStates.get(conn.id)?.status === 'success'">
                          <i class="fas fa-check-circle"></i>
                          {{ connectionTestStates.get(conn.id)?.resultText }}
                        </template>
                        <template v-else-if="connectionTestStates.get(conn.id)?.status === 'error'">
                          <i class="fas fa-times-circle"></i>
                          {{ t('connections.test.errorPrefix', '错误:') }} {{ connectionTestStates.get(conn.id)?.resultText }}
                        </template>
                      </div>
                    </div>
                  </li>
                  </template>
                </draggable>
              </div>
                </template>
              </div>
            </div>

            <div v-else-if="!isLoadingConnections && searchQuery && filteredAndSortedConnections.length === 0" class="server-state">
              <i class="fas fa-search"></i>
              <span>{{ t('dashboard.noConnectionsMatchSearch', '没有连接匹配搜索条件') }}</span>
            </div>
            <div v-else-if="!isLoadingConnections && selectedFolderId !== null && filteredAndSortedConnections.length === 0" class="server-state">
              <i class="fas fa-folder-open"></i>
              <span>{{ t('connections.folders.noConnectionsInFolder', '该文件夹下没有服务器') }}</span>
            </div>
            <div v-else class="server-state">
              <i class="fas fa-server"></i>
              <span>{{ t('dashboard.noConnections', '没有连接记录') }}</span>
            </div>
          </div>

          <div class="server-bottom-actions">
            <div
              class="server-actions-menu-wrap"
              @mouseenter="openServerActionMenu"
              @mouseleave="scheduleServerActionMenuClose"
              @focusin="openServerActionMenu"
            >
              <button
                ref="serverActionButtonRef"
                type="button"
                class="server-bottom-button"
                :class="{ active: isServerActionMenuOpen }"
                :aria-label="t('dock.actions', '操作菜单')"
                :title="t('dock.actions', '操作菜单')"
                @pointerdown.stop
                @click.stop="openServerActionMenu"
              >
                <i class="fas fa-user-gear"></i>
              </button>
              <div
                v-if="isServerActionMenuOpen"
                ref="serverActionMenuRef"
                class="server-actions-menu"
                @pointerdown.stop
                @click.stop
              >
                <RouterLink
                  :to="{ name: 'Settings' }"
                  class="server-actions-menu-item"
                  @click="closeServerActionMenu"
                >
                  <i class="fas fa-gear"></i>
                  <span>{{ t('nav.settings') }}</span>
                </RouterLink>
                <RouterLink
                  v-if="accountFeatureAvailable && !isAuthenticated"
                  :to="{ name: 'Login' }"
                  class="server-actions-menu-item"
                  @click="closeServerActionMenu"
                >
                  <i class="fas fa-right-to-bracket"></i>
                  <span>{{ t('nav.login') }}</span>
                </RouterLink>
                <button
                  v-else-if="accountFeatureAvailable"
                  type="button"
                  class="server-actions-menu-item danger"
                  @click="handleLogout"
                >
                  <i class="fas fa-right-from-bracket"></i>
                  <span>{{ t('nav.logout') }}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              class="server-bottom-button"
              :aria-label="themeToggleLabel"
              :title="themeToggleLabel"
              :disabled="isSwitchingTheme"
              @click="toggleTheme"
            >
              <i :class="isDarkUiThemeActive ? 'fas fa-sun' : 'fas fa-moon'"></i>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="server-panel-resizer"
          :title="t('connections.folders.resizePanel', '拖拽调整服务器列表宽度')"
          :aria-label="t('connections.folders.resizePanel', '拖拽调整服务器列表宽度')"
          @pointerdown="startServerPanelResize"
          @dblclick="resetServerPanelWidth"
        ></button>
      </section>

      <button
        v-if="!isServerPanelCollapsed && !isServerActionMenuOpen"
        type="button"
        class="server-panel-mobile-dismiss-overlay"
        :aria-label="t('connections.folders.collapsePanel', '收起侧边栏')"
        @click="collapseServerPanel"
      ></button>

      <teleport to="body">
        <div
          v-if="isTagFilterOpen"
          ref="tagFilterMenuRef"
          class="server-tag-filter-menu"
          :style="tagFilterMenuStyle"
          @click.stop
        >
          <div class="server-tag-filter-menu-header">
            <span>{{ t('connections.table.tags', '标签') }}</span>
            <button type="button" :disabled="selectedTagCount === 0" @click="clearTagFilters">
              {{ t('common.clear', '清除') }}
            </button>
          </div>
          <button
            type="button"
            class="server-tag-filter-item"
            :class="{ active: selectedTagCount === 0 }"
            @click="clearTagFilters"
          >
            <i class="fas fa-layer-group"></i>
            <span>{{ t('dashboard.filterTags.all', '所有标签') }}</span>
          </button>
          <button
            v-for="tag in (tags as TagInfo[])"
            :key="tag.id"
            type="button"
            class="server-tag-filter-item"
            :class="{ active: isTagSelected(tag.id) }"
            @click="toggleTagFilter(tag.id)"
          >
            <i :class="['fas', isTagSelected(tag.id) ? 'fa-check-square' : 'fa-square']"></i>
            <span>{{ tag.name }}</span>
          </button>
          <div v-if="tags.length === 0" class="server-tag-filter-empty">
            {{ t('tags.noTags', '暂无标签') }}
          </div>
        </div>
      </teleport>

      <section class="connection-workspace">
        <WorkspaceView />
      </section>
    </div>

    <teleport to="body">
      <div
        v-if="serverContextMenu.visible"
        class="server-context-menu"
        :style="{ top: `${serverContextMenu.y}px`, left: `${serverContextMenu.x}px` }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <button
          v-if="serverContextMenu.targetType !== 'connection'"
          type="button"
          @click="handleCreateFolderFromContext"
        >
          <i class="fas fa-folder-plus"></i>
          <span>{{ t('connections.folders.createFolder', '新建文件夹') }}</span>
        </button>
        <template v-if="serverContextMenu.targetType === 'connection'">
          <button
            type="button"
            :disabled="!contextTargetConnection || !isConnectionTestSupported(contextTargetConnection.type)"
            @click="handleTestConnectionFromContext"
          >
            <i class="fas fa-plug"></i>
            <span>{{ t('connections.actions.testConnection', '测试连接') }}</span>
          </button>
          <button type="button" @click="handleEditConnectionFromContext">
            <i class="fas fa-pencil-alt"></i>
            <span>{{ t('connections.actions.editServer', '编辑服务器') }}</span>
          </button>
          <button type="button" class="danger" @click="handleDeleteConnectionFromContext">
            <i class="fas fa-trash-alt"></i>
            <span>{{ t('connections.actions.deleteServer', '删除服务器') }}</span>
          </button>
        </template>
        <button
          v-if="serverContextMenu.targetType === 'folder' && serverContextMenu.targetFolderId !== null"
          type="button"
          @click="handleRenameFolderFromContext"
        >
          <i class="fas fa-i-cursor"></i>
          <span>{{ t('connections.folders.renameFolder', '重命名文件夹') }}</span>
        </button>
        <button
          v-if="serverContextMenu.targetType !== 'connection'"
          type="button"
          @click="handleAddConnectionFromContext"
        >
          <i class="fas fa-plus"></i>
          <span>{{ t('connections.addConnection', '添加新连接') }}</span>
        </button>
        <button
          v-if="serverContextMenu.targetType === 'folder' && serverContextMenu.targetFolderId !== null"
          type="button"
          class="danger"
          @click="handleDeleteFolderFromContext"
        >
          <i class="fas fa-trash-alt"></i>
          <span>{{ t('connections.folders.deleteFolder', '删除文件夹') }}</span>
        </button>
      </div>
    </teleport>

    <AddConnectionForm
      v-if="showAddEditConnectionForm"
      :connectionToEdit="connectionToEdit"
      :initial-tag-ids="initialConnectionTagIds"
      :initial-folder-id="initialConnectionFolderId"
      @close="handleFormClose"
      @connection-added="handleConnectionModified"
      @connection-updated="handleConnectionModified"
    />

    <BatchEditConnectionForm
      v-if="showBatchEditForm"
      :visible="showBatchEditForm"
      :connection-ids="Array.from(selectedConnectionIdsForBatch)"
      @update:visible="handleBatchEditFormClose"
      @saved="handleBatchEditSaved"
    />
  </div>
</template>

<style scoped>
.connections-page {
  height: 100%;
  max-height: 100%;
  min-height: 0;
  background: var(--app-bg-color);
  color: var(--text-color);
  overflow: hidden;
}

.connections-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.server-list-panel {
  position: relative;
  display: flex;
  height: 100%;
  flex-shrink: 0;
  border-right: 2px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  background: color-mix(in srgb, var(--header-bg-color) 92%, var(--app-bg-color));
  overflow: hidden;
  transition: width 0.12s ease, min-width 0.12s ease;
}

.server-list-panel.is-collapsed {
  cursor: e-resize;
  border-right-width: 2px;
  background: color-mix(in srgb, var(--header-bg-color) 88%, var(--border-color));
}

.server-list-panel.is-resizing {
  transition: none;
}

.server-list-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  padding: 0.75rem 1rem;
  overflow: hidden;
}

.server-list-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.125rem 0 0.75rem;
}

.server-list-title {
  display: flex;
  align-items: baseline;
  min-width: 0;
  gap: 0.5rem;
}

.server-list-title h1 {
  margin: 0;
  color: var(--text-color);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
}

.server-list-title span {
  min-width: 1.55rem;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-color-secondary);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.server-search-row,
.server-filter-row,
.server-command-row {
  display: flex;
  width: 100%;
  gap: 0.5rem;
}

.server-search-row {
  margin-bottom: 0.5rem;
}

.server-filter-row {
  position: relative;
  margin-bottom: 0.5rem;
}

.server-command-row {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.server-search-box {
  position: relative;
  flex: 1;
  min-width: 0;
}

.server-search-box i {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  color: var(--text-color-secondary);
  font-size: 0.9rem;
  transform: translateY(-50%);
  pointer-events: none;
}

.server-search-box input,
.server-select {
  width: 100%;
  min-width: 0;
  height: 2.45rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--app-bg-color);
  color: var(--text-color);
  font-size: 0.86rem;
  outline: none;
  transition: border-color 0.12s ease, background-color 0.12s ease, box-shadow 0.12s ease;
}

.server-search-box input {
  padding: 0 0.85rem 0 2.25rem;
}

.server-select {
  flex: 1;
  padding: 0 0.7rem;
}

.server-tag-filter {
  position: static;
  flex-shrink: 0;
}

.server-tag-filter-button {
  position: relative;
}

.server-tag-filter-button.active {
  border-color: color-mix(in srgb, var(--link-active-color) 52%, var(--border-color));
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.server-tag-filter-count {
  position: absolute;
  top: -0.35rem;
  right: -0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border: 1px solid var(--app-bg-color);
  border-radius: 999px;
  background: var(--button-bg-color);
  color: var(--button-text-color);
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1;
}

.server-tag-filter-menu {
  position: fixed;
  z-index: 120;
  max-height: 18rem;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  border-radius: 0.55rem;
  background: var(--header-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
  overflow-y: auto;
}

.server-tag-filter-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.45rem 0.45rem;
  color: var(--text-color-secondary);
  font-size: 0.72rem;
  font-weight: 800;
}

.server-tag-filter-menu-header button {
  border: 0;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 700;
}

.server-tag-filter-menu-header button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.server-tag-filter-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.55rem;
  min-height: 2rem;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: 0.42rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.82rem;
  text-align: left;
}

.server-tag-filter-item:hover,
.server-tag-filter-item:focus-visible,
.server-tag-filter-item.active {
  background: var(--nav-item-active-bg-color);
}

.server-tag-filter-item i {
  width: 1rem;
  color: var(--text-color-secondary);
  text-align: center;
}

.server-tag-filter-item.active i {
  color: var(--link-active-color);
}

.server-tag-filter-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-tag-filter-empty {
  padding: 0.75rem 0.5rem;
  color: var(--text-color-secondary);
  font-size: 0.8rem;
  text-align: center;
}

.server-search-box input:focus,
.server-select:focus {
  border-color: color-mix(in srgb, var(--link-active-color) 58%, var(--border-color));
  background: var(--header-bg-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link-active-color) 12%, transparent);
}

.server-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.45rem;
  height: 2.45rem;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--app-bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
}

.server-icon-button:hover,
.server-icon-button:focus-visible {
  border-color: color-mix(in srgb, var(--text-color) 28%, var(--border-color));
  background: var(--nav-item-active-bg-color);
  color: var(--text-color);
}

.server-icon-button i,
.server-entry-icon i,
.server-batch-bar button i,
.server-test-result i {
  color: currentColor;
}

.server-icon-button-primary,
.server-entry-action-primary {
  background: var(--button-bg-color);
  color: var(--button-text-color);
  border-color: var(--button-bg-color);
}

.server-icon-button-primary:hover,
.server-icon-button-primary:focus-visible,
.server-entry-action-primary:hover,
.server-entry-action-primary:focus-visible {
  background: var(--button-hover-bg-color);
  color: var(--button-text-color);
  border-color: var(--button-hover-bg-color);
}

.server-icon-button:disabled,
.server-entry-action:disabled,
.server-batch-bar button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.server-batch-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  user-select: none;
}

.server-switch {
  position: relative;
  width: 2.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 58%, transparent);
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.server-switch span {
  position: absolute;
  left: 0.15rem;
  top: 50%;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 999px;
  background: var(--app-bg-color);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.22);
  transform: translateY(-50%);
  transition: transform 0.12s ease;
}

.server-switch.active {
  border-color: color-mix(in srgb, var(--link-active-color) 52%, var(--border-color));
  background: var(--nav-item-active-bg-color);
}

.server-switch.active span {
  transform: translate(0.95rem, -50%);
}

.server-command-actions {
  display: flex;
  gap: 0.4rem;
}

.server-batch-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.65rem;
  padding: 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--app-bg-color) 72%, var(--header-bg-color));
}

.server-batch-bar button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.85rem;
  padding: 0.25rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0.45rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.76rem;
  font-weight: 600;
}

.server-batch-bar button:hover,
.server-batch-bar button:focus-visible {
  background: var(--nav-item-active-bg-color);
}

.server-batch-bar button.danger {
  color: var(--color-error);
}

.server-list-body {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--border-color) 82%, var(--text-color-secondary)) transparent;
}

.server-list-body::-webkit-scrollbar {
  width: 4px;
}

.server-list-body::-webkit-scrollbar-track {
  background: transparent;
}

.server-list-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 82%, var(--text-color-secondary));
}

.server-bottom-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.server-bottom-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.45rem;
  height: 2.45rem;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--app-bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
}

.server-bottom-button:hover,
.server-bottom-button:focus-visible,
.server-bottom-button.active {
  border-color: color-mix(in srgb, var(--link-active-color) 52%, var(--border-color));
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.server-bottom-button:disabled {
  cursor: wait;
  opacity: 0.58;
}

.server-bottom-button i {
  color: currentColor;
  font-size: 1rem;
  line-height: 1;
}

.server-actions-menu-wrap {
  position: relative;
  display: inline-flex;
}

.server-actions-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 0.5rem);
  z-index: 30;
  min-width: 12rem;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  border-radius: 0.55rem;
  background: var(--header-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
}

.server-actions-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: 0.42rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.86rem;
  text-align: left;
  text-decoration: none;
}

.server-actions-menu-item:hover,
.server-actions-menu-item:focus-visible,
.server-actions-menu-item.router-link-active {
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.server-actions-menu-item.danger {
  color: var(--color-error);
}

.server-actions-menu-item.danger:hover,
.server-actions-menu-item.danger:focus-visible {
  background: color-mix(in srgb, var(--color-error) 14%, transparent);
  color: var(--color-error);
}

.server-actions-menu-item i {
  width: 1.05rem;
  color: currentColor;
  text-align: center;
}

.server-actions-menu-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-folder-tree {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.server-folder-drag-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.server-folder {
  min-width: 0;
}

.server-folder-header {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 0.5rem;
  padding: 0.4rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 0.45rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.84rem;
  font-weight: 700;
  text-align: left;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.server-folder-header:hover,
.server-folder-header:focus-visible {
  border-color: color-mix(in srgb, var(--border-color) 72%, transparent);
  background: color-mix(in srgb, var(--nav-item-active-bg-color) 72%, transparent);
}

.server-folder-header i {
  width: 0.95rem;
  flex-shrink: 0;
  color: var(--text-color-secondary);
  font-size: 0.75rem;
  text-align: center;
}

.server-folder-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-folder-name-input {
  min-width: 0;
  height: 1.65rem;
  flex: 1;
  padding: 0 0.4rem;
  border: 1px solid color-mix(in srgb, var(--link-active-color) 56%, var(--border-color));
  border-radius: 0.35rem;
  background: var(--app-bg-color);
  color: var(--text-color);
  font: inherit;
  font-weight: 700;
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link-active-color) 12%, transparent);
}

.server-folder-name-input:disabled {
  cursor: wait;
  opacity: 0.66;
}

.server-folder-count {
  min-width: 1.35rem;
  padding: 0.05rem 0.36rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-color-secondary);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
}

.server-entries {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
  user-select: none;
}

.server-entries-root {
  margin-bottom: 0.2rem;
}

.server-folder .server-entries {
  padding-left: 0.9rem;
}

.server-entry {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.48rem;
  border: 1px solid transparent;
  border-radius: 0.45rem;
  color: var(--text-color);
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  cursor: pointer;
}

.server-entry:active {
  cursor: pointer;
}

.server-entry:hover,
.server-entry:focus-within {
  border-color: color-mix(in srgb, var(--border-color) 80%, var(--text-color-secondary));
  background: var(--nav-item-active-bg-color);
}

.server-entry-batch {
  cursor: pointer;
}

.server-entry-selected {
  border-color: var(--link-active-color);
  background: color-mix(in srgb, var(--link-active-color) 14%, transparent);
}

.server-entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  flex-shrink: 0;
  border-radius: 0.28rem;
  font-size: 2.0rem;
}

.server-entry-content {
  min-width: 0;
  flex: 1;
  padding-top: 0.05rem;
  padding-right: 2rem;
}

.server-entry-mainline {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.server-entry-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-entry-type {
  padding: 0.05rem 0.32rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-color-secondary);
  font-size: 0.64rem;
  font-weight: 700;
  line-height: 1.1;
  text-transform: uppercase;
}

.server-entry-meta {
  overflow: hidden;
  color: var(--text-color-secondary);
  font-size: 0.76rem;
  font-weight: 500;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-drag-ghost {
  opacity: 0.42;
  background: color-mix(in srgb, var(--link-active-color) 14%, var(--app-bg-color));
}

.server-drag-chosen {
  border-color: color-mix(in srgb, var(--link-active-color) 52%, var(--border-color));
}

.server-entry-meta {
  display: flex;
  gap: 0.45rem;
}

.server-entry-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-entry-detail-popover {
  position: absolute;
  top: calc(100% - 0.1rem);
  left: 2.6rem;
  right: 0.45rem;
  z-index: 9;
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.55rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, var(--text-color-secondary));
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--header-bg-color) 96%, var(--app-bg-color));
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.22);
  opacity: 0;
  transform: translateY(0.2rem);
  transition: opacity 0.08s ease, transform 0.08s ease;
  pointer-events: none;
}

.server-entry:hover .server-entry-detail-popover,
.server-entry:focus-within .server-entry-detail-popover {
  opacity: 1;
  transform: translateY(0.35rem);
}

.server-entry-detail-row {
  display: grid;
  grid-template-columns: minmax(3.5rem, max-content) minmax(0, 1fr);
  gap: 0.5rem;
  align-items: baseline;
  min-width: 0;
  color: var(--text-color);
  font-size: 0.75rem;
  line-height: 1.25;
}

.server-entry-detail-label {
  color: var(--text-color-secondary);
  font-weight: 700;
  white-space: nowrap;
}

.server-entry-detail-value {
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-entry-tags {
  display: flex;
  min-width: 0;
  max-width: 45%;
  flex-shrink: 0;
  flex-wrap: nowrap;
  gap: 0.25rem;
  overflow: hidden;
}

.server-entry-tags span {
  max-width: 4.8rem;
  padding: 0.08rem 0.38rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-color-secondary);
  font-size: 0.66rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-test-result {
  position: absolute;
  top: 50%;
  right: 0.45rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.22rem;
  max-width: 4.9rem;
  min-width: 1.85rem;
  height: 1.85rem;
  padding: 0 0.42rem;
  border: 1px solid color-mix(in srgb, currentColor 28%, var(--border-color));
  border-radius: 0.42rem;
  background: var(--app-bg-color);
  font-size: 0.7rem;
  font-weight: 800;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateY(-50%);
}

.server-test-result-error {
  color: var(--color-error);
}

.server-test-result-testing {
  color: var(--text-color-secondary);
}

.server-state {
  display: flex;
  height: 100%;
  min-height: 14rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 1.25rem;
  color: var(--text-color-secondary);
  font-size: 0.9rem;
  text-align: center;
}

.server-state i {
  font-size: 1.45rem;
}

.connection-workspace {
  min-width: 0;
  flex: 1;
  background: var(--app-bg-color);
  overflow: hidden;
}

.connection-workspace :deep(.workspace-view) {
  height: 100%;
}

.connection-workspace :deep(.terminal-tab-bar) {
  margin: 0;
  border-radius: 0;
  border-top: 0;
  border-left: 0;
}

.connection-workspace :deep(.main-content-area) {
  margin: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0;
}

.server-panel-resizer {
  position: absolute;
  top: 0;
  right: -0.3rem;
  z-index: 2;
  width: 0.65rem;
  height: 100%;
  border: 0;
  background: transparent;
  cursor: col-resize;
}

.server-list-panel.is-collapsed .server-panel-resizer {
  right: -0.25rem;
  width: 0.9rem;
  cursor: e-resize;
}

.server-panel-resizer::after {
  content: "";
  position: absolute;
  top: 0.75rem;
  bottom: 0.75rem;
  left: 50%;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transform: translateX(-50%);
  transition: background-color 0.12s ease, box-shadow 0.12s ease;
}

.server-panel-resizer:hover::after,
.server-panel-resizer:focus-visible::after,
.server-list-panel.is-resizing .server-panel-resizer::after {
  background: var(--link-active-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link-active-color) 16%, transparent);
}

.server-panel-mobile-dismiss-overlay {
  display: none;
}

.server-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 13rem;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  border-radius: 0.55rem;
  background: var(--header-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
}

.server-context-menu button {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: 0.42rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.86rem;
  text-align: left;
}

.server-context-menu button:hover,
.server-context-menu button:focus-visible {
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.server-context-menu button.danger {
  color: var(--color-error);
}

.server-context-menu button.danger:hover,
.server-context-menu button.danger:focus-visible {
  background: color-mix(in srgb, var(--color-error) 14%, transparent);
  color: var(--color-error);
}

.server-context-menu i {
  width: 1.05rem;
  color: currentColor;
  text-align: center;
}

@media (max-width: 900px) {
  .server-panel-mobile-dismiss-overlay {
    position: absolute;
    inset: 0;
    display: block;
    z-index: 11;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .server-list-panel:not(.is-collapsed) {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 12;
    width: min(84vw, 22rem) !important;
    min-width: min(84vw, 22rem) !important;
    max-width: min(84vw, 22rem);
    box-shadow: 10px 0 28px rgba(15, 23, 42, 0.18);
  }

  .server-list-panel.is-collapsed {
    width: 0 !important;
    min-width: 0 !important;
    border-right-width: 0;
  }
}

@media (max-width: 768px) {
  .connections-layout {
    display: flex;
  }

  .server-list-panel {
    flex-shrink: 0;
  }

  .connection-workspace {
    display: block;
    height: 100%;
  }

}
</style>
