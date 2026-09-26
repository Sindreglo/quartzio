import type { CellEdit, GanttController } from '@quartzio/gantt';
import { type ReactElement, useLayoutEffect, useRef } from 'react';

export const INPUT_TYPES = {
  text: 'text',
  duration: 'text',
  percent: 'text',
  date: 'date',
  datetime: 'datetime-local',
};

/**
 * The field for the cell being edited. The engine holds the text and decides what the keys do and whether the
 * value is valid; this only passes them on.
 */
export function CellEditor({
  gantt,
  edit,
  label,
  onDone,
}: {
  gantt: GanttController;
  edit: CellEdit;
  label: string;
  /** The edit was saved or cancelled with a key: focus goes back to the chart. */
  onDone: () => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    if (input.type === 'text') input.select();
  }, [edit.taskId, edit.columnId]);
  // Removed while focused (its row scrolled out of the rendered window, or hidden): focus goes back to the chart
  // instead of the page. The engine saves an edit left open like that on the next key or press. Checked once the
  // field is really gone: StrictMode runs this cleanup once without removing anything. (`onDone` is stable.)
  useLayoutEffect(() => {
    const input = ref.current;
    return () => {
      if (!input || document.activeElement !== input) return;
      queueMicrotask(() => {
        if (
          !input.isConnected &&
          (document.activeElement === null || document.activeElement === document.body)
        ) {
          onDone();
        }
      });
    };
  }, [onDone]);
  // Still this cell's edit (a blur can come after the engine moved on, e.g. with Tab).
  const isOpen = () => {
    const current = gantt.getState().editing;
    return current?.taskId === edit.taskId && current.columnId === edit.columnId;
  };
  return (
    <>
      <input
        ref={ref}
        className={edit.error ? 'qz-cell-editor qz-cell-editor--invalid' : 'qz-cell-editor'}
        type={INPUT_TYPES[edit.kind]}
        inputMode={edit.kind === 'percent' ? 'decimal' : undefined}
        value={edit.text}
        aria-label={label}
        aria-invalid={edit.error !== null}
        onChange={(event) => {
          gantt.editInput(event.target.value);
        }}
        onKeyDown={(event) => {
          // Keys in the field are the field's, not the chart's.
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return; // Enter confirms the input method's text, not the edit
          const { key, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = event;
          if (!gantt.editKeyDown({ key, shift, ctrl, meta, alt })) return;
          event.preventDefault();
          if (gantt.getState().editing === null) onDone();
        }}
        // Leaving the field saves it; a value that can't be saved is dropped.
        onBlur={() => {
          // The window losing focus (switching apps to copy something) isn't leaving the field.
          if (!document.hasFocus()) return;
          if (isOpen() && !gantt.commitEdit()) gantt.cancelEdit();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
        }}
      />
      {edit.error && (
        <div className="qz-cell-editor__error" role="alert">
          {edit.error}
        </div>
      )}
    </>
  );
}
