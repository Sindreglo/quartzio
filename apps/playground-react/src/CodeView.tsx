import { useMemo, useState } from 'react';
import { highlight } from 'sugar-high';
import { sourceOf } from './sources';

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * The source of what a demo shows, one tab per file (paths from src/), with a copy button. Collapsed until asked
 * for, unless `open`.
 */
export function CodeView({ files, open = false }: { files: readonly string[]; open?: boolean }) {
  const [shown, setShown] = useState(open);
  const [active, setActive] = useState(files[0] ?? '');
  const [copied, setCopied] = useState(false);
  const code = sourceOf(active) ?? '';
  // Our own source files, so the HTML the highlighter builds from them is safe to insert.
  const html = useMemo(() => (shown ? highlight(code) : ''), [code, shown]);

  if (!shown) {
    return (
      <button
        type="button"
        className="pg-code-toggle"
        onClick={() => {
          setShown(true);
        }}
      >
        <span aria-hidden="true">{'</>'}</span> Show code
      </button>
    );
  }

  return (
    <section className="pg-codeview" aria-label="Source code">
      <div className="pg-codeview__bar">
        <div className="pg-codeview__tabs" role="tablist">
          {files.map((path) => (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={path === active}
              title={path}
              onClick={() => {
                setActive(path);
                setCopied(false);
              }}
            >
              {fileName(path)}
            </button>
          ))}
        </div>
        <div className="pg-codeview__actions">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(code).then(
                () => {
                  setCopied(true);
                },
                () => undefined,
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShown(false);
            }}
          >
            Hide
          </button>
        </div>
      </div>
      <pre className="pg-codeview__code">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </section>
  );
}
