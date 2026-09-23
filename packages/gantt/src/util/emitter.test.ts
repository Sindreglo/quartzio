import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from './emitter';

describe('createEmitter', () => {
  it('notifies subscribers until they unsubscribe', () => {
    const emitter = createEmitter<number>();
    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    emitter.emit(1);
    unsubscribe();
    emitter.emit(2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('still notifies later listeners when an earlier one unsubscribes during emit', () => {
    const emitter = createEmitter<number>();
    const second = vi.fn();
    const unsubscribeFirst = emitter.subscribe(() => {
      unsubscribeFirst();
    });
    emitter.subscribe(second);

    emitter.emit(1);

    expect(second).toHaveBeenCalledTimes(1);
  });
});
