let scrollFrameId: number | null = null;
const pendingScrolls = new Map<Element, ScrollIntoViewOptions | undefined>();

export const scheduleScrollIntoView = (
  element: Element,
  options?: ScrollIntoViewOptions,
) => {
  pendingScrolls.set(element, options);

  if (scrollFrameId !== null) return;

  scrollFrameId = window.requestAnimationFrame(() => {
    scrollFrameId = null;
    const scrollList = [...pendingScrolls.entries()];
    pendingScrolls.clear();
    scrollList.forEach(([target, targetOptions]) => target.scrollIntoView(targetOptions));
  });
};

export const cancelScheduledScrollIntoView = () => {
  if (scrollFrameId !== null) {
    window.cancelAnimationFrame(scrollFrameId);
    scrollFrameId = null;
  }
  pendingScrolls.clear();
};
