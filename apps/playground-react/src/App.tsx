import { useEffect, useState } from 'react';
import { type Demo, demos } from './demos';
import { Navbar, type Theme } from './Navbar';
import { useRoute } from './router';

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

function DemoSection({ demo, heading }: { demo: Demo; heading: 'h1' | 'h2' }) {
  const Heading = heading;
  return (
    <section id={demo.id} className="pg-demo">
      <header className="pg-header">
        <Heading>{demo.title}</Heading>
        <p>{demo.description}</p>
      </header>
      <demo.Component />
    </section>
  );
}

export function App() {
  const { section, target, only } = useRoute();
  const [theme, setTheme] = useState(storedTheme);

  // On the root element, so the whole playground (and every chart in it) follows, as an app would do it.
  useEffect(() => {
    document.documentElement.classList.toggle('qz-dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private mode: the theme just isn't remembered.
    }
  }, [theme]);

  useEffect(() => {
    document.title = `${(only ?? section).title} · Quartzio Playground`;
  }, [only, section]);

  // A demo in the address: scroll to it once its section is shown.
  useEffect(() => {
    if (target && !only) document.getElementById(target.id)?.scrollIntoView({ block: 'start' });
  }, [target, only, section]);

  const inSection = demos.filter((demo) => demo.section === section.id);

  return (
    <>
      <Navbar section={section} theme={theme} onTheme={setTheme} />
      <main className="pg-main" key={only ? `only:${only.id}` : section.id}>
        {only ? (
          <DemoSection demo={only} heading="h1" />
        ) : (
          <>
            {/* The page's heading for screen readers; the demos' titles are what shows. */}
            <h1 className="pg-visually-hidden">{section.title}</h1>
            {inSection.map((demo) => (
              <DemoSection key={demo.id} demo={demo} heading="h2" />
            ))}
          </>
        )}
      </main>
    </>
  );
}
