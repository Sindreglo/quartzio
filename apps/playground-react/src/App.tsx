import { useEffect, useState } from 'react';
import { demos } from './demos';

const demoIdFromHash = (): string => window.location.hash.slice(1);

export function App() {
  const [demoId, setDemoId] = useState(demoIdFromHash);

  useEffect(() => {
    const onHashChange = () => {
      setDemoId(demoIdFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const active = demos.find((demo) => demo.id === demoId) ?? demos[0];

  return (
    <div className="pg-layout">
      <nav className="pg-nav">
        <h1 className="pg-title">Quartzio</h1>
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
