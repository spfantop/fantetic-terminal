import { debugLog, debugLogLazy } from '../composables/useDebugLog';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import apiClient from '../utils/apiClient';
import {
  CONFIGURABLE_LAYOUT_PANES,
  isConfigurableLayoutPane,
  normalizeLayoutTree,
  normalizeConfigurablePaneList,
  type ConfigurableLayoutPane,
  type SidebarPaneConfig,
} from '../utils/layoutPanes';
import {
  cloneDefaultSidebarPanes,
  createDefaultLayout,
} from '../utils/defaultLayoutConfig';

// 定义所有可用面板的名称
export type PaneName = ConfigurableLayoutPane;

// 定义布局节点接口
export interface LayoutNode {
  id: string; // 唯一 ID
  type: 'pane' | 'container'; // 节点类型：面板或容器
  component?: PaneName; // 如果 type 是 'pane'，指定要渲染的组件
  sessionId?: string | null; // 历史分屏布局兼容字段，加载和保存时会被清理
  direction?: 'horizontal' | 'vertical'; // 如果 type 是 'container'，指定分割方向
  children?: LayoutNode[]; // 如果 type 是 'container'，包含子节点数组
  size?: number; // 节点在父容器中的大小比例 (例如 20, 50, 30)
}

// 本地存储的 Key
const LAYOUT_STORAGE_KEY = 'fantetic_terminal_layout_config';
const SIDEBAR_STORAGE_KEY = 'fantetic_terminal_sidebar_config'; // 新增侧栏配置 Key

// 生成唯一 ID 的辅助函数
function generateId(): string {
  // 简单实现，实际项目中可能使用更健壮的库如 uuid
  return Math.random().toString(36).substring(2, 15);
}

// 定义默认布局结构 (根据用户提供的配置更新，但使用 generateId)
const getDefaultLayout = (): LayoutNode => createDefaultLayout(generateId);

// 定义默认侧栏配置 (根据用户提供的配置更新)
const getDefaultSidebarPanes = (): SidebarPaneConfig => cloneDefaultSidebarPanes();

// 递归查找主布局树中使用的面板
function getMainLayoutUsedPaneNames(node: LayoutNode | null): Set<PaneName> {
  const usedNames = new Set<PaneName>();
  if (!node) return usedNames;

  function traverse(currentNode: LayoutNode) {
    if (currentNode.type === 'pane' && currentNode.component) {
      usedNames.add(currentNode.component);
    } else if (currentNode.type === 'container' && currentNode.children) {
      currentNode.children.forEach(traverse);
    }
  }

  traverse(node);
  return usedNames;
}

// 获取所有使用的面板（主布局 + 侧栏）
function getAllUsedPaneNames(mainNode: LayoutNode | null, sidebars: { left: PaneName[], right: PaneName[] }): Set<PaneName> {
  const usedNames = getMainLayoutUsedPaneNames(mainNode);
  sidebars.left.forEach(pane => usedNames.add(pane));
  sidebars.right.forEach(pane => usedNames.add(pane));
  return usedNames;
}

function cloneLayoutNode(node: LayoutNode): LayoutNode {
  return {
    ...node,
    children: node.children?.map(cloneLayoutNode),
  };
}

export function areLayoutNodesEqual(left: LayoutNode | null, right: LayoutNode | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.id !== right.id || left.type !== right.type) return false;
  if (left.component !== right.component || left.direction !== right.direction) return false;
  if (left.sessionId !== right.sessionId) return false;
  if ((left.size ?? null) !== (right.size ?? null)) return false;

  const leftChildren = left.children ?? [];
  const rightChildren = right.children ?? [];
  if (leftChildren.length !== rightChildren.length) return false;

  return leftChildren.every((child, index) => areLayoutNodesEqual(child, rightChildren[index]));
}

export function areSidebarPanesEqual(left: { left: PaneName[], right: PaneName[] }, right: { left: PaneName[], right: PaneName[] }) {
  const isSamePaneList = (a: PaneName[], b: PaneName[]) => a.length === b.length && a.every((pane, index) => pane === b[index]);
  return isSamePaneList(left.left, right.left) && isSamePaneList(left.right, right.right);
}
function sanitizeLayoutTree(node: LayoutNode | null): LayoutNode | null {
  const normalizedNode = normalizeLayoutTree(node) as LayoutNode | null;
  if (!normalizedNode) return null;
  if (normalizedNode.type === 'pane' && normalizedNode.component === 'terminal') {
    delete normalizedNode.sessionId;
  }
  return normalizedNode;
}

function normalizeSidebarPaneConfig(value: { left?: unknown[]; right?: unknown[] } | null | undefined): SidebarPaneConfig | null {
  if (!value || !Array.isArray(value.left) || !Array.isArray(value.right)) return null;

  return {
    left: normalizeConfigurablePaneList(value.left),
    right: normalizeConfigurablePaneList(value.right),
  };
}


// 定义 Store
export const useLayoutStore = defineStore('layout', () => {
  // --- 状态 ---
  // 主布局树结构
  const layoutTree: Ref<LayoutNode | null> = ref(null);
  // 侧栏面板配置
  const sidebarPanes: Ref<SidebarPaneConfig> = ref(getDefaultSidebarPanes());
  // 所有理论上可用的面板名称
  const allPossiblePanes: Ref<PaneName[]> = ref([...CONFIGURABLE_LAYOUT_PANES]);
  // 控制布局（Header/Footer）可见性的状态
  const isLayoutVisible: Ref<boolean> = ref(true); // 控制整体布局（Header/Footer）可见性
  // 控制主导航栏（Header）可见性的状态
  const isHeaderVisible: Ref<boolean> = ref(true); // 默认可见

  // --- 计算属性 ---
  // 计算当前布局和侧栏中正在使用的所有面板
  const usedPanes: ComputedRef<Set<PaneName>> = computed(() => getAllUsedPaneNames(layoutTree.value, sidebarPanes.value));

  // 计算当前未在布局或侧栏中使用的面板（可用于配置器中添加）
  const availablePanes: ComputedRef<PaneName[]> = computed(() => {
    const used = usedPanes.value;
    return allPossiblePanes.value.filter(pane => !used.has(pane));
  });

  function ensureNodeIds(node: LayoutNode | null): LayoutNode | null {
    if (!node) return null;

    if (!node.id) {
      console.warn('[Layout Store] Node is missing ID, generating one:', node);
      node.id = generateId();
    }

    if (node.type === 'container' && node.children) {
      node.children = node.children.map(child => ensureNodeIds(child)).filter(Boolean) as LayoutNode[];
    }

    return node;
  }

  async function loadLayoutProjection(): Promise<LayoutNode> {
    try {
      const response = await apiClient.get<LayoutNode | null>('/settings/layout');
      const remoteLayout = ensureNodeIds(sanitizeLayoutTree(response.data));
      if (remoteLayout) {
        try {
          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(remoteLayout));
        } catch (error) {
          console.error('[Layout Store] Failed to cache layout projection:', error);
        }
        return remoteLayout;
      }
    } catch (error) {
      console.error('[Layout Store] Failed to load layout projection:', error);
    }

    try {
      const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (savedLayout) {
        const localLayout = ensureNodeIds(sanitizeLayoutTree(JSON.parse(savedLayout) as LayoutNode));
        if (localLayout) return localLayout;
      }
    } catch (error) {
      console.error('[Layout Store] Failed to restore cached layout projection:', error);
    }

    return getDefaultLayout();
  }

  async function loadSidebarProjection(): Promise<SidebarPaneConfig> {
    try {
      const response = await apiClient.get<{ left: unknown[]; right: unknown[] } | null>('/settings/sidebar');
      const remoteSidebarPanes = normalizeSidebarPaneConfig(response.data);
      if (remoteSidebarPanes) {
        try {
          localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(remoteSidebarPanes));
        } catch (error) {
          console.error('[Layout Store] Failed to cache sidebar projection:', error);
        }
        return remoteSidebarPanes;
      }
    } catch (error) {
      console.error('[Layout Store] Failed to load sidebar projection:', error);
    }

    try {
      const savedSidebars = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (savedSidebars) {
        const localSidebarPanes = normalizeSidebarPaneConfig(
          JSON.parse(savedSidebars) as { left: unknown[]; right: unknown[] },
        );
        if (localSidebarPanes) return localSidebarPanes;
      }
    } catch (error) {
      console.error('[Layout Store] Failed to restore cached sidebar projection:', error);
    }

    return getDefaultSidebarPanes();
  }

  async function loadHeaderVisibilityProjection(): Promise<boolean> {
    try {
      const response = await apiClient.get<{ visible: boolean }>('/settings/nav-bar-visibility');
      if (typeof response.data?.visible === 'boolean') return response.data.visible;
      console.warn('[Layout Store] Invalid header visibility projection, using default.');
    } catch (error) {
      console.error('[Layout Store] Failed to load header visibility projection:', error);
    }
    return true;
  }

  let initializationPromise: Promise<void> | null = null;

  function initialize(): Promise<void> {
    if (!initializationPromise) {
      initializationPromise = Promise.all([
        loadLayoutProjection(),
        loadSidebarProjection(),
        loadHeaderVisibilityProjection(),
      ]).then(([loadedLayout, loadedSidebarPanes, loadedHeaderVisibility]) => {
        // 三个用户布局投影同时提交，避免首屏观察到半初始化状态。
        layoutTree.value = loadedLayout;
        sidebarPanes.value = loadedSidebarPanes;
        isHeaderVisible.value = loadedHeaderVisibility;
      });
    }
    return initializationPromise;
  }

  // --- Helper for debounced persistence ---
  // We still might want debounce if updates happen rapidly outside the configurator (e.g., pane resize)
  let persistLayoutDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersistLayout = () => {
      if (persistLayoutDebounceTimer) clearTimeout(persistLayoutDebounceTimer);
      persistLayoutDebounceTimer = setTimeout(async () => { // Make async
          await persistLayoutTree(); // Await the async persist function
      }, 1000);
  };

  // 更新整个布局树（通常由配置器保存时调用）
  async function updateLayoutTree(newTree: LayoutNode | null) { // Make async
    // 可选：添加验证逻辑
    if (newTree) {
        newTree = sanitizeLayoutTree(newTree);
    }
    // Check if the tree actually changed before updating and persisting
    if (!areLayoutNodesEqual(newTree, layoutTree.value)) {
        layoutTree.value = newTree;
        debugLog('[Layout Store] 布局树已更新。 New tree:', newTree);
        // --- Directly call persist ---
        await persistLayoutTree(); // Await persistence directly
    } else {
        debugLog('[Layout Store] updateLayoutTree called but tree is unchanged.');
    }
  }

  // 更新侧栏配置
  async function updateSidebarPanes(newPanes: SidebarPaneConfig) { // Make async
    // --- Add Validation ---
    const normalizedPanes = normalizeSidebarPaneConfig(newPanes);
    if (normalizedPanes)
    {
        // Check if panes actually changed
        if (!areSidebarPanesEqual(normalizedPanes, sidebarPanes.value)) {
            sidebarPanes.value = normalizedPanes; // Assign validated data
            debugLogLazy(() => ['[Layout Store] 侧栏配置已通过验证并更新。 New sidebarPanes value:', JSON.parse(JSON.stringify(sidebarPanes.value))]);
            // --- Directly call persist ---
            await persistSidebarPanes(); // Await persistence directly
        } else {
             debugLog('[Layout Store] updateSidebarPanes called but panes are unchanged.');
        }
    } else {
        console.error('[Layout Store] updateSidebarPanes 接收到无效的侧栏配置数据，未更新状态:', newPanes);
        // 可选：抛出错误或通知用户
    }
  }
  // 递归查找并更新节点大小
  function findAndUpdateNodeSize(node: LayoutNode | null, nodeId: string, childrenSizes: { index: number; size: number }[]): LayoutNode | null {
    if (!node) return null;

    if (node.id === nodeId && node.type === 'container' && node.children) {
      const sizeByIndex = new Map(childrenSizes.map(({ index, size }) => [index, size]));
      let changed = false;
      const updatedChildren = node.children.map((child, index) => {
        const nextSize = sizeByIndex.get(index);
        if (nextSize === undefined) return child;
        const currentSize = child.size ?? 0;
        if (Math.abs(currentSize - nextSize) < 0.0001) return child;

        changed = true;
        return { ...child, size: nextSize };
      });

      return changed ? { ...node, children: updatedChildren } : node;
    }

    if (node.type === 'container' && node.children) {
      let changed = false;
      const updatedChildren = node.children.map((child) => {
        const updatedChild = findAndUpdateNodeSize(child, nodeId, childrenSizes);
        if (updatedChild !== child) {
          changed = true;
        }
        return updatedChild ?? child;
      });

      return changed ? { ...node, children: updatedChildren } : node;
    }

    return node;
  }


  // 更新特定容器节点的子节点大小
  function updateNodeSizes(nodeId: string, childrenSizes: { index: number; size: number }[]) {
    debugLog(`[Layout Store] 请求更新节点 ${nodeId} 的子节点大小:`, childrenSizes);
    const previousTree = layoutTree.value;
    const updatedTree = findAndUpdateNodeSize(previousTree, nodeId, childrenSizes);

    if (updatedTree && updatedTree !== previousTree) {
       layoutTree.value = updatedTree;
       debugLog(`[Layout Store] 节点 ${nodeId} 的子节点大小已更新，触发防抖保存。`);
       // --- Use debounced persist for resize ---
       debouncedPersistLayout();
    } else {
       debugLog(`[Layout Store] 未找到节点 ${nodeId} 或大小未改变。`);
    }
  }
  // 切换布局（Header/Footer）的可见性
  function toggleLayoutVisibility() {
    isLayoutVisible.value = !isLayoutVisible.value;
    debugLog(`[Layout Store] 布局可见性切换为: ${isLayoutVisible.value}`);
    // 注意：这个状态目前不与后端同步
  }

  // 切换主导航栏可见性并同步到后端
  async function toggleHeaderVisibility() {
    const newValue = !isHeaderVisible.value;
    debugLog(`[Layout Store] Toggling header visibility to: ${newValue}`);
    isHeaderVisible.value = newValue; // 立即更新 UI

    try {
      // --- 调用后端 API (复用 nav-bar-visibility 接口) ---
      await apiClient.put('/settings/nav-bar-visibility', { visible: newValue }); // 使用 apiClient
      debugLog('[Layout Store] Header visibility saved to backend.');
    } catch (error) {
      console.error('[Layout Store] Failed to save header visibility to backend:', error);
    }
  }

 // 获取系统内置的默认布局
 function getSystemDefaultLayout(): LayoutNode {
   debugLog('[Layout Store] Getting system default layout.');
   return getDefaultLayout(); // 直接调用内部函数
 }

 // 获取系统内置的默认侧栏配置
 function getSystemDefaultSidebarPanes(): { left: PaneName[], right: PaneName[] } {
     debugLog('[Layout Store] Getting system default sidebar panes.');
     return getDefaultSidebarPanes();
 }

 // 将当前主布局树持久化到后端和 localStorage
 async function persistLayoutTree() { // Make async
   // ... (existing try/catch logic for backend and localStorage) ...
   // Ensure apiClient calls are awaited if they return promises
   try {
     debugLog('[Layout Store] Attempting to save main layout to backend...');
     await apiClient.put('/settings/layout', layoutTree.value); // await
     debugLog('[Layout Store] 主布局已成功保存到后端 (sent value):', layoutTree.value);
   } catch (error) {
     console.error('[Layout Store] 保存主布局到后端失败:', error);
   }
   // localStorage is synchronous
   try {
     const layoutToSave = JSON.stringify(layoutTree.value);
     localStorage.setItem(LAYOUT_STORAGE_KEY, layoutToSave);
     debugLog('[Layout Store] 主布局已自动保存到 localStorage (saved value):', layoutToSave);
   } catch (error) {
     console.error('[Layout Store] 保存主布局到 localStorage 失败:', error);
   }
 }

 // 将当前侧栏配置持久化到后端和 localStorage
 async function persistSidebarPanes() { // Make async
    // ... (existing try/catch logic for backend and localStorage) ...
    try {
         debugLog('[Layout Store] Attempting to save sidebar config to backend...');
         await apiClient.put('/settings/sidebar', sidebarPanes.value); // await
         debugLog('[Layout Store] 侧栏配置已成功保存到后端。');
     } catch (error) {
         console.error('[Layout Store] 保存侧栏配置到后端失败:', error);
     }
     // localStorage is synchronous
     try {
         const sidebarsToSave = JSON.stringify(sidebarPanes.value);
         localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarsToSave);
         debugLog('[Layout Store] 侧栏配置已自动保存到 localStorage。');
     } catch (error) {
         console.error('[Layout Store] 保存侧栏配置到 localStorage 失败:', error);
     }
 }


 // --- 返回 ---
 return {
   // State
   layoutTree,
   sidebarPanes, // <--- 暴露侧栏状态
   allPossiblePanes,
   isLayoutVisible,
   isHeaderVisible,
   // Computed
   availablePanes,
   usedPanes,
   // Actions
   updateLayoutTree,
   updateSidebarPanes, // <--- 暴露侧栏更新 action
   initialize,
   updateNodeSizes,
   generateId,
   toggleLayoutVisibility,
   toggleHeaderVisibility,
   getSystemDefaultLayout,
   getSystemDefaultSidebarPanes, // <--- 暴露获取默认侧栏配置的方法
   // Persist actions (可选暴露，如果需要手动触发)
   // persistLayoutTree,
   // persistSidebarPanes,
 };
});
