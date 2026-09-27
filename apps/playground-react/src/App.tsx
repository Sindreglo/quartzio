import { useEffect, useState } from 'react';
import { demos } from './demos';

const demoIdFromHash = (): string => window.location.hash.slice(1);

type Theme = 'light' | 'dark';
const THEME_KEY = 'qz-playground-theme';

function storedTheme(): Theme {
  // ?theme=dark in the URL wins (used by pnpm verify:layout).
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function App() {
  const [demoId, setDemoId] = useState(demoIdFromHash);
  const [theme, setTheme] = useState(storedTheme);

  useEffect(() => {
    const onHashChange = () => {
      setDemoId(demoIdFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  // On the root element, so the whole playground (and every chart in it) follows, as an app would do it.
  useEffect(() => {
    document.documentElement.classList.toggle('qz-dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private mode: the theme just isn't remembered.
    }
  }, [theme]);

  const active = demos.find((demo) => demo.id === demoId) ?? demos[0];

  return (
    <div className="pg-layout">
      <nav className="pg-nav">
        <div className="pg-brand">
          <img
            className="pg-logo"
            src={theme === 'dark' ? '/quartzio-logo-dark-bg.svg' : '/quartzio-logo-light-bg.svg'}
            alt="Quartzio"
          />
          <span className="pg-eyebrow">Playground</span>
        </div>
        <div className="pg-segmented" role="group" aria-label="Theme">
          {(['light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => {
                setTheme(option);
              }}
            >
              {option === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <ul>
          {demos.map((demo) => (
            <li key={demo.id}>
              <a href={`#${demo.id}`} aria-current={demo === active ? 'page' : undefined}>
                {demo.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="pg-main">
        {active && (
          <>
            <header className="pg-header">
              <span className="pg-eyebrow">{active.id}</span>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
            </header>
            <active.Component />
          </>
        )}
      </main>
    </div>
  );
}
