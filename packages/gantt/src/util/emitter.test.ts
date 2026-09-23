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

  it('delivers events emitted by a listener after the current one, in order, to everyone', () => {
    const emitter = createEmitter<string>();
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    emitter.subscribe((value) => {
      seenByA.push(value);
      if (value === 'first') emitter.emit('second');
    });
    emitter.subscribe((value) => seenByB.push(value));

    emitter.emit('first');

    expect(seenByA).toEqual(['first', 'second']);
    expect(seenByB).toEqual(['first', 'second']); // not ['second', 'first']
  });

  it('notifies every listener even when one throws, then rethrows', () => {
    const emitter = createEmitter<number>();
    const listener = vi.fn();
    emitter.subscribe(() => {
      throw new Error('bug');
    });
    emitter.subscribe(listener);

    expect(() => {
      emitter.emit(1);
    }).toThrow('bug');
    expect(listener).toHaveBeenCalledWith(1);

    expect(() => {
      emitter.emit(2);
    }).toThrow('bug');
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('treats the same listener subscribed twice as two subscriptions', () => {
    const emitter = createEmitter<number>();
    const listener = vi.fn();
    const unsubscribeFirst = emitter.subscribe(listener);
    emitter.subscribe(listener);

    unsubscribeFirst();
    emitter.emit(1);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
