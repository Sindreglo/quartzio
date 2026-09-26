import type {
  DependencyType,
  GanttController,
  TaskEditorAction,
  TaskEditorField,
  TaskEditorSide,
  TaskEditorState,
  TaskEditorTab,
} from '@quartzio/gantt';
import { type ReactElement, type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import { INPUT_TYPES } from './CellEditor';
import { focusBackWhenGone } from './events';

type Dispatch = (action: TaskEditorAction) => boolean;

/** Replaces the dialog's content; `dispatch` does what the built-in form does (typing, saving, closing). */
export type RenderTaskEditor = (editor: TaskEditorState, dispatch: Dispatch) => ReactNode;

const TABS: readonly [TaskEditorTab, string][] = [
  ['general', 'General'],
  ['predecessors', 'Predecessors'],
  ['successors', 'Successors'],
  ['advanced', 'Advanced'],
];
const TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * The task editor: a modal `<dialog>` (the browser traps focus and turns Escape into cancel). The engine holds the
 * draft, reads the values and saves; this shows the form and passes what's typed on.
 */
export function TaskEditorDialog({
  gantt,
  editor,
  render,
  onDone,
}: {
  gantt: GanttController;
  editor: TaskEditorState;
  render: RenderTaskEditor | undefined;
  onDone: () => void;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      focusBackWhenGone(dialog, onDone);
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    };
  }, [onDone]);
  const dispatch = gantt.taskEditorAction;
  return (
    <dialog
      ref={ref}
      className="qz-task-editor"
      aria-label={`Edit ${editor.task.name || 'task'}`}
      onCancel={(event) => {
        event.preventDefault(); // closed by the engine, so the state says so
        dispatch({ type: 'close' });
      }}
      // Closed by the browser anyway (a form with method="dialog" in renderTaskEditor, say): tell the engine.
      // Checked a little later: StrictMode closes and reopens it, and the close event may come either side of that.
      onClose={(event) => {
        const dialog = event.currentTarget;
        queueMicrotask(() => {
          if (!dialog.open && gantt.getState().taskEditor) dispatch({ type: 'close' });
        });
      }}
      onKeyDown={(event) => {
        event.stopPropagation(); // the dialog's keys, not the chart's
      }}
    >
      {render ? render(editor, dispatch) : <EditorForm editor={editor} dispatch={dispatch} />}
    </dialog>
  );
}

function EditorForm({ editor, dispatch }: { editor: TaskEditorState; dispatch: Dispatch }): ReactElement {
  const id = useId();
  return (
    <form
      className="qz-task-editor__form"
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: 'save' });
      }}
    >
      <h2 className="qz-task-editor__title">{editor.task.name || 'Task'}</h2>
      <div className="qz-task-editor__tabs" role="tablist">
        {TABS.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${id}-${tab}`}
            aria-selected={editor.tab === tab}
            className="qz-task-editor__tab"
            onClick={() => dispatch({ type: 'tab', tab })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="qz-task-editor__panel" role="tabpanel" aria-labelledby={`${id}-${editor.tab}`}>
        {editor.tab === 'general' && (
          <>
            <Field editor={editor} dispatch={dispatch} field="name" label="Name" />
            <div className="qz-task-editor__row">
              <Field editor={editor} dispatch={dispatch} field="startDate" label="Start" />
              <Field editor={editor} dispatch={dispatch} field="endDate" label="End" />
            </div>
            <div className="qz-task-editor__row">
              <Field editor={editor} dispatch={dispatch} field="duration" label="Duration" />
              <Field editor={editor} dispatch={dispatch} field="percentDone" label="% Done" />
            </div>
            <label className="qz-task-editor__check">
              <input
                type="checkbox"
                checked={editor.manuallyScheduled}
                onChange={(event) =>
                  dispatch({ type: 'input', field: 'manuallyScheduled', value: event.target.checked })
                }
              />
              Manually scheduled
            </label>
          </>
        )}
        {(editor.tab === 'predecessors' || editor.tab === 'successors') && (
          <Dependencies editor={editor} dispatch={dispatch} side={editor.tab} />
        )}
        {editor.tab === 'advanced' && (
          <>
            <label className="qz-task-editor__field">
              <span>Constraint</span>
              <select
                value={editor.constraintType}
                onChange={(event) =>
                  dispatch({
                    type: 'input',
                    field: 'constraintType',
                    value: event.target.value === 'none' ? 'none' : 'startnoearlierthan',
                  })
                }
              >
                <option value="none">None</option>
                <option value="startnoearlierthan">Start no earlier than</option>
              </select>
            </label>
            <Field editor={editor} dispatch={dispatch} field="constraintDate" label="Constraint date" />
          </>
        )}
      </div>
      {editor.error && (
        <p className="qz-task-editor__error" role="alert">
          {editor.error}
        </p>
      )}
      <div className="qz-task-editor__buttons">
        <button type="button" onClick={() => dispatch({ type: 'close' })}>
          Cancel
        </button>
        <button type="submit" className="qz-task-editor__save">
          Save
        </button>
      </div>
    </form>
  );
}

function Field({
  editor,
  dispatch,
  field,
  label,
}: {
  editor: TaskEditorState;
  dispatch: Dispatch;
  field: TaskEditorField;
  label: string;
}): ReactElement {
  const state = editor.fields[field];
  const id = useId();
  return (
    // The message outside the label, so the field's name stays just the label.
    <div className="qz-task-editor__field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={INPUT_TYPES[state.kind]}
        value={state.text}
        disabled={state.disabled}
        aria-invalid={state.error !== null}
        aria-describedby={state.error ? `${id}-error` : undefined}
        onChange={(event) => dispatch({ type: 'input', field, value: event.target.value })}
      />
      {state.error && (
        <span id={`${id}-error`} className="qz-task-editor__field-error">
          {state.error}
        </span>
      )}
    </div>
  );
}

function Dependencies({
  editor,
  dispatch,
  side,
}: {
  editor: TaskEditorState;
  dispatch: Dispatch;
  side: TaskEditorSide;
}): ReactElement {
  const rows = editor[side];
  const update = (key: string, changes: Extract<TaskEditorAction, { type: 'updateDependency' }>['changes']) =>
    dispatch({ type: 'updateDependency', side, key, changes });
  return (
    <div className="qz-task-editor__dependencies">
      {rows.length === 0 && <p className="qz-task-editor__empty">None</p>}
      {rows.map((row) => (
        <div key={row.key} className="qz-task-editor__dependency">
          <div className="qz-task-editor__row">
            <select
              aria-label="Task"
              // By position: ids 1 and "1" are different tasks.
              value={String(editor.candidates.findIndex((candidate) => candidate.id === row.taskId))}
              onChange={(event) => {
                const chosen = editor.candidates[Number(event.target.value)];
                update(row.key, { taskId: chosen ? chosen.id : null });
              }}
            >
              <option value="-1">Choose a task…</option>
              {editor.candidates.map((candidate, index) => (
                <option key={index} value={String(index)}>
                  {' '.repeat(candidate.depth * 3)}
                  {candidate.name || String(candidate.id)}
                </option>
              ))}
            </select>
            <select
              aria-label="Type"
              value={row.type}
              onChange={(event) => update(row.key, { type: event.target.value as DependencyType })}
            >
              {TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <input
              aria-label="Lag"
              className="qz-task-editor__lag"
              value={row.lag}
              onChange={(event) => update(row.key, { lag: event.target.value })}
            />
            <button
              type="button"
              aria-label="Remove"
              onClick={() => dispatch({ type: 'removeDependency', side, key: row.key })}
            >
              ×
            </button>
          </div>
          {row.error && <span className="qz-task-editor__field-error">{row.error}</span>}
        </div>
      ))}
      <button type="button" onClick={() => dispatch({ type: 'addDependency', side })}>
        Add {side === 'predecessors' ? 'predecessor' : 'successor'}
      </button>
    </div>
  );
}
