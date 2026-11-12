import { SECTIONS, type Section } from './demos';
import { onLinkClick } from './router';

export type Theme = 'light' | 'dark';

/** The top bar: the logo, one link per section, and the theme switch. */
export function Navbar({
  section: current,
  theme,
  onTheme,
}: {
  section: Section;
  theme: Theme;
  onTheme: (theme: Theme) => void;
}) {
  return (
    <header className="pg-navbar">
      <div className="pg-navbar__inner">
        <a className="pg-brand" href="/" onClick={onLinkClick}>
          <img
            className="pg-logo"
            src={theme === 'dark' ? '/quartzio-logo-dark-bg.svg' : '/quartzio-logo-light-bg.svg'}
            alt="Quartzio"
          />
          <span className="pg-brand__label">Playground</span>
        </a>
        <nav className="pg-navbar__sections" aria-label="Sections">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`/${section.id}`}
              aria-current={section === current ? 'page' : undefined}
              onClick={onLinkClick}
            >
              {section.title}
            </a>
          ))}
        </nav>
        <div className="pg-navbar__end">
          <div className="pg-segmented" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
                onClick={() => {
                  onTheme(option);
                }}
              >
                {option === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <a className="pg-navbar__link" href="https://github.com/Sindreglo/quartzio">
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
