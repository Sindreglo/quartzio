import { shareTreeIndex } from './tree';
import type { Id, ProjectSettings, ProjectState, StoreName, StoreRecords, Table } from './types';

export interface DraftTable<R extends { readonly id: Id }> {
  byId: Map<Id, R>;
  order: Id[];
}

/**
 * Mutable, copy-on-write view of a ProjectState. Tables are cloned on first write only, so
 * untouched tables keep their identity in the finished state (cheap change detection downstream).
 */
export class Draft {
  private readonly base: ProjectState;
  private readonly writable = new Map<StoreName, DraftTable<{ readonly id: Id }>>();
  private readonly version = new Map<StoreName, number>();
  private readonly structureVersion = new Map<StoreName, number>();
  private settings: ProjectSettings | undefined;

  constructor(base: ProjectState) {
    this.base = base;
  }

  read<S extends StoreName>(store: S): Table<StoreRecords[S]> {
    const table: Table<{ readonly id: Id }> = this.writable.get(store) ?? this.base[store];
    return table as Table<StoreRecords[S]>;
  }

  write<S extends StoreName>(store: S): DraftTable<StoreRecords[S]> {
    this.version.set(store, (this.version.get(store) ?? 0) + 1);
    let table = this.writable.get(store);
    if (!table) {
      const source: Table<{ readonly id: Id }> = this.base[store];
      table = { byId: new Map(source.byId), order: [...source.order] };
      this.writable.set(store, table);
    }
    return table as DraftTable<StoreRecords[S]>;
  }

  readSettings(): ProjectSettings {
    return this.settings ?? this.base.settings;
  }

  writeSettings(settings: ProjectSettings): void {
    this.settings = settings;
  }

  /** Increments on every write to the store; lets callers cache derived data per version. */
  versionOf(store: StoreName): number {
    return this.version.get(store) ?? 0;
  }

  /** Records a change to the store's structure: records added, removed or moved, or a task's parent. */
  markStructure(store: StoreName): void {
    this.structureVersion.set(store, (this.structureVersion.get(store) ?? 0) + 1);
  }

  /** Increments on every structural change (see markStructure), e.g. to cache the task tree. */
  structureVersionOf(store: StoreName): number {
    return this.structureVersion.get(store) ?? 0;
  }

  finish(): ProjectState {
    if (this.writable.size === 0 && this.settings === undefined) return this.base;
    const tasks = this.read('tasks');
    if (this.structureVersionOf('tasks') === 0) shareTreeIndex(this.base.tasks, tasks);
    return {
      settings: this.readSettings(),
      calendars: this.read('calendars'),
      tasks,
      dependencies: this.read('dependencies'),
    };
  }
}
