export const createKeyedRunOnce = <Key, Result>(
  operation: (key: Key) => Promise<Result>,
): ((key: Key) => Promise<Result>) => {
  const pendingMap = new Map<Key, Promise<Result>>();
  return (key: Key): Promise<Result> => {
    const existing = pendingMap.get(key);
    if (existing) return existing;
    const pending = operation(key);
    pendingMap.set(key, pending);
    const release = () => {
      if (pendingMap.get(key) === pending) pendingMap.delete(key);
    };
    pending.then(release, release);
    return pending;
  };
};
