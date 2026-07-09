import { ref, type Ref } from 'vue';
import type { FileListItem } from '../../types/sftp.types'; // 确保路径正确

// 定义 Composable 的输入参数类型
export interface UseFileManagerSelectionOptions {
  // 注意：这里传入的应该是当前渲染在表格中的列表 (可能已排序/过滤)
  // 在 FileManager.vue 中，这通常是 filteredFileList 或 sortedFileList
  displayedFileList: Ref<Readonly<FileListItem[]>>;
  // 回调函数，当需要执行导航或打开文件时调用
  onItemAction: (item: FileListItem) => void;
}

export function useFileManagerSelection(options: UseFileManagerSelectionOptions) {
  const { displayedFileList, onItemAction } = options;

  const selectedItems = ref(new Set<string>());
  const lastClickedIndex = ref(-1); // 索引相对于 displayedFileList

  const handleItemClick = (event: MouseEvent, item: FileListItem) => {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    // 查找点击项在当前显示列表中的索引
    const itemIndex = displayedFileList.value.findIndex((f) => f.filename === item.filename);

    // 如果找不到项（理论上不应发生），或者点击的是 '..'
    // (注意: '..' 通常是单独处理或在列表开头，这里假设它不在 displayedFileList 中，或者其点击事件由外部单独处理)
    // 我们主要处理 displayedFileList 中的项的选择逻辑
    if (itemIndex === -1) {
        if (item.filename === '..') {
            if (!ctrlOrMeta && !shift) {
                selectedItems.value.clear();
                lastClickedIndex.value = -1;
            }
        } else {
             // 如果不是 '..' 且找不到索引，则忽略无效点击
             return;
        }
        return;

    }


    // --- 主要选择逻辑 ---
    // --- 调整后的主要选择逻辑 ---
    if (ctrlOrMeta) { // 1. 检查 Ctrl/Meta
      event.preventDefault();
      event.stopPropagation(); // <-- 阻止冒泡
      // Ctrl/Cmd + Click: Toggle selection
      // '..' 不应参与多选 (已在前面处理)
      // if (item.filename === '..') return; // '..' 已在前面处理
      if (selectedItems.value.has(item.filename)) {
        selectedItems.value.delete(item.filename);
      } else {
        selectedItems.value.add(item.filename); // Keep the add operation
      }
      // Removed the extra else block here
      lastClickedIndex.value = itemIndex; // 更新最后点击的索引
    } else if (shift) { // 2. 检查 Shift (移除 lastClickedIndex !== -1 条件)
      event.preventDefault();
      event.stopPropagation(); // <-- 阻止冒泡
      // Shift + Click: Range selection
      // '..' 不应参与范围选择 (已在前面处理)
      // if (item.filename === '..') return; // '..' 已在前面处理
      selectedItems.value.clear();
      // 如果 lastClickedIndex 是 -1 (例如第一次 Shift 点击)，则只选中当前项
      const start = lastClickedIndex.value === -1 ? itemIndex : Math.min(lastClickedIndex.value, itemIndex);
      const end = lastClickedIndex.value === -1 ? itemIndex : Math.max(lastClickedIndex.value, itemIndex);
      for (let i = start; i <= end; i++) {
        // 确保索引有效且不是 '..'
        const fileToAdd = displayedFileList.value[i];
        if (fileToAdd && fileToAdd.filename !== '..') {
          selectedItems.value.add(fileToAdd.filename);
        }
      }
      // Shift-click 也更新 lastClickedIndex 为当前点击项
      lastClickedIndex.value = itemIndex;
    } else { // 3. 处理普通单击 (没有修饰键)
      // 普通单击仅选中，打开/进入目录交给双击或键盘 Enter。
      selectedItems.value.clear();
      // '..' 不应被加入 selectedItems。
      if (item.filename !== '..') {
        selectedItems.value.add(item.filename);
        lastClickedIndex.value = itemIndex; // 更新最后点击的索引
      } else {
        // 点击 '..' 的 lastClickedIndex 已在前面处理
        // lastClickedIndex.value = -1;
      }
    }
  };

  const handleItemDoubleClick = (event: MouseEvent, item: FileListItem) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (item.filename !== '..') {
      selectedItems.value.clear();
      selectedItems.value.add(item.filename);
      const itemIndex = displayedFileList.value.findIndex((f) => f.filename === item.filename);
      lastClickedIndex.value = itemIndex;
    } else {
      selectedItems.value.clear();
      lastClickedIndex.value = -1;
    }
    onItemAction(item);
  };

  // 清空选择的辅助函数，可能在其他地方（如路径改变时）需要
  const clearSelection = () => {
      selectedItems.value.clear();
      lastClickedIndex.value = -1;
  };

  return {
    selectedItems,
    lastClickedIndex, // 只读暴露，主要由内部管理
    handleItemClick,
    handleItemDoubleClick,
    clearSelection, // 暴露清空选择的方法
  };
}
