import {
  applyPatch,
  createProject,
  type GanttController,
  getTreeIndex,
  type Id,
  type Patch,
  type ProjectData,
  type Transaction,
} from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useMemo, useRef, useState } from 'react';
import { sampleProject } from '../data/sampleProject';

const initialData = createProject(sampleProject).toData();
const invert = (patch: Patch): Patch => ({ operations: patch.inverse, inverse: patch.operations });

/**
 * Controlled usage: the app owns the data, the Gantt reports edits as patches, and undo/redo is just
 * applying inverse patches to the data with `applyPatch`.
 */
export function DataModelDemo() {
  const gantt = useRef<GanttController>(null);
  const [data, setData] = useState<ProjectData>(initialData);
  const [selected, setSelected] = useState<Id | null>(null);
  const [undoStack, setUndoStack] = useState<Patch[]>([]);
  const [redoStack, setRedoStack] = useState<Patch[]>([]);
  const [lastPatch, setLastPatch] = useState<Patch | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tree = useMemo(
    () =>
      getTreeIndex({
        byId: new Map(data.tasks.map((task) => [task.id, task])),
        order: data.tasks.map((task) => task.id),
      }),
    [data],
  );
  const taskById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data]);

  const edit = (fn: (tx: Transaction) => void) => {
    setError(null);
    try {
      gantt.current?.transact(fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleChange = ({ patch, data: next }: { patch: Patch; data: ProjectData }) => {
    setData(next);
    setLastPatch(patch);
    setUndoStack((stack) => [...stack, patch]);
    setRedoStack([]);
  };

  const undo = () => {
    const patch = undoStack.at(-1);
    if (!patch) return;
    setData(applyPatch(data, invert(patch)));
    setLastPatch(invert(patch));
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, patch]);
  };

  const redo = () => {
    const patch = redoStack.at(-1);
    if (!patch) return;
    setData(applyPatch(data, patch));
    setLastPatch(patch);
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, patch]);
  };

  const siblingsOf = (id: Id) => tree.children(taskById.get(id)?.parentId ?? null);

  // Edits that act on the selected task.
  const taskActions = {
    addSubtask: (id: Id, tx: Transaction) => {
      tx.tasks.add({ name: 'New subtask' }, { parentId: id });
    },
    rename: (id: Id, tx: Transaction) => {
      tx.tasks.update(id, { name: `${taskById.get(id)?.name ?? ''} ✎` });
    },
    progress: (id: Id, tx: Transaction) => {
      tx.tasks.update(id, { percentDone: ((taskById.get(id)?.percentDone ?? 0) + 25) % 125 });
    },
    moveUp: (id: Id, tx: Transaction) => {
      tx.tasks.move(id, { index: Math.max(0, siblingsOf(id).indexOf(id) - 1) });
    },
    moveDown: (id: Id, tx: Transaction) => {
      tx.tasks.move(id, { index: siblingsOf(id).indexOf(id) + 1 });
    },
    indent: (id: Id, tx: Transaction) => {
      const siblings = siblingsOf(id);
      const previous = siblings[siblings.indexOf(id) - 1];
      if (previous !== undefined) tx.tasks.move(id, { parentId: previous });
    },
    outdent: (id: Id, tx: Transaction) => {
      const parentId = taskById.get(id)?.parentId ?? null;
      if (parentId === null) return;
      const grandParentId = taskById.get(parentId)?.parentId ?? null;
      tx.tasks.move(id, { parentId: grandParentId, index: siblingsOf(parentId).indexOf(parentId) + 1 });
    },
    remove: (id: Id, tx: Transaction) => {
      tx.tasks.remove(id);
      setSelected(null);
    },
  };

  const runOnSelected = (action: (id: Id, tx: Transaction) => void) => {
    if (selected === null) return;
    edit((tx) => {
      action(selected, tx);
    });
  };

  const addTask = () => {
    edit((tx) => {
      setSelected(tx.tasks.add({ name: 'New task' }).id);
    });
  };

  const taskButtons: [label: string, action: (id: Id, tx: Transaction) => void][] = [
    ['Add subtask', taskActions.addSubtask],
    ['Rename', taskActions.rename],
    ['+25% done', taskActions.progress],
    ['↑', taskActions.moveUp],
    ['↓', taskActions.moveDown],
    ['← Outdent', taskActions.outdent],
    ['Indent →', taskActions.indent],
    ['Delete', taskActions.remove],
  ];

  return (
    <div className="pg-stack">
      <div className="pg-toolbar">
        <button onClick={addTask}>Add task</button>
        <span className="pg-divider" />
        {taskButtons.map(([label, action]) => (
          <button
            key={label}
            disabled={selected === null}
            onClick={() => {
              runOnSelected(action);
            }}
          >
            {label}
          </button>
        ))}
        <span className="pg-divider" />
        <button disabled={undoStack.length === 0} onClick={undo}>
          Undo
        </button>
        <button disabled={redoStack.length === 0} onClick={redo}>
          Redo
        </button>
      </div>
      {error && <p className="pg-error">{error}</p>}

      <div className="pg-columns">
        <section className="pg-panel">
          <h3>
            Tasks ({data.tasks.length}) · dependencies ({data.dependencies.length})
          </h3>
          <ul className="pg-tree">
            {tree.flatten().map((id) => {
              const task = taskById.get(id);
              return (
                <li key={String(id)}>
                  <button
                    className="pg-tree-row"
                    aria-pressed={id === selected}
                    style={{ paddingLeft: 8 + tree.depth(id) * 18 }}
                    onClick={() => {
                      setSelected(id === selected ? null : id);
                    }}
                  >
                    <span>{task?.name === '' ? '(unnamed)' : task?.name}</span>
                    <span className="pg-muted">{task?.percentDone}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="pg-panel">
          <h3>Last patch</h3>
          <pre className="pg-code">
            {lastPatch ? JSON.stringify(lastPatch, null, 2) : 'Make an edit to see its patch.'}
          </pre>
        </section>
      </div>

      <section>
        <h3>&lt;Gantt data=&#123;data&#125; onChange=&#123;…&#125; /&gt;</h3>
        <Gantt ref={gantt} data={data} onChange={handleChange} style={{ height: 120 }} />
      </section>
    </div>
  );
}
