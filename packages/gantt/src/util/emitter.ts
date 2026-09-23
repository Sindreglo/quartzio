export type Listener<T> = (value: T) => void;

export interface Emitter<T> {
  subscribe: (listener: Listener<T>) => () => void;
  emit: (value: T) => void;
  clear: () => void;
}

export function createEmitter<T>(): Emitter<T> {
  // Each subscription gets its own entry, so subscribing the same function twice needs two unsubscribes.
  const listeners = new Set<{ listener: Listener<T> }>();
  const queue: T[] = [];
  let emitting = false;

  return {
    subscribe(listener) {
      const entry = { listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    emit(value) {
      queue.push(value);
      // An event emitted from inside a listener waits until everyone has seen the current one, so every
      // listener sees events in the same order (and the last one it sees is the latest).
      if (emitting) return;
      emitting = true;
      let failure: { error: unknown } | undefined;
      try {
        // An array iterator also visits items appended while iterating: events queued by listeners.
        for (const next of queue) {
          // Snapshot so listeners that unsubscribe during emit don't skip their neighbours.
          for (const entry of [...listeners]) {
            // One failing listener must not keep the others from being notified; rethrow afterwards.
            try {
              entry.listener(next);
            } catch (error) {
              failure ??= { error };
            }
          }
        }
      } finally {
        emitting = false;
        queue.length = 0;
      }
      if (failure) throw failure.error;
    },
    clear() {
      listeners.clear();
    },
  };
}
