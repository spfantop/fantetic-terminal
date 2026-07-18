import { watch, type Ref } from 'vue';

export const createSingleFlight = <T>(task: () => Promise<T>): (() => Promise<T>) => {
  let activePromise: Promise<T> | null = null;

  return () => {
    if (activePromise) return activePromise;

    let currentPromise: Promise<T>;
    try {
      currentPromise = task();
    } catch (error) {
      return Promise.reject(error);
    }

    activePromise = currentPromise;
    const clearActivePromise = () => {
      if (activePromise === currentPromise) activePromise = null;
    };
    currentPromise.then(clearActivePromise, clearActivePromise);
    return currentPromise;
  };
};

export const waitForRefValue = <T>(
  source: Readonly<Ref<T>>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  if (predicate(source.value)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let stopWatching = () => {};
    let timeoutId: ReturnType<typeof setTimeout>;

    const settle = (matched: boolean) => {
      if (settled) return;
      settled = true;
      stopWatching();
      clearTimeout(timeoutId);
      resolve(matched);
    };

    stopWatching = watch(source, (value) => {
      if (predicate(value)) settle(true);
    }, { flush: 'sync' });
    timeoutId = setTimeout(() => settle(false), Math.max(0, timeoutMs));
  });
};
