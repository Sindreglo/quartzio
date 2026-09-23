export type Listener<T> = (value: T) => void;

export interface Emitter<T> {
  subscribe: (listener: Listener<T>) => () => void;
  emit: (value: T) => void;
  clear: () => void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      // Snapshot so listeners that unsubscribe during emit don't skip their neighbours.
      for (const listener of [...listeners]) listener(value);
    },
    clear() {
      listeners.clear();
    },
  };
}
