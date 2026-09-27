import { EverydayScenario } from './version-0-1/EverydayScenario';
import { PowerScenario } from './version-0-1/PowerScenario';

/**
 * Realistic scenarios for the first release, two charts on one page: an everyday user who enters a small plan
 * and keeps the defaults, and a power user who drives most of the library from an app of their own.
 */
export function Version01Demo() {
  return (
    <div className="pg-stack">
      <section className="pg-scenario">
        <h3>1. Everyday user: a kitchen renovation</h3>
        <p className="pg-muted">
          Twenty tasks in four phases, entered once. No options: drag bars, double-click to edit, right-click
          for the menu, Ctrl/Cmd+Z to undo. The chart keeps the edits itself.
        </p>
        <EverydayScenario />
      </section>
      <section className="pg-scenario">
        <h3>2. Power user: a construction program</h3>
        <p className="pg-muted">
          An office building in Oslo on the building-site calendar (7.5-hour days, public holidays, the
          builders&apos; holiday in July, daylight saving time), with every dependency type and lags,
          fixed-date deliveries and "start no earlier than" constraints. The app owns the data (controlled),
          keeps its own work packages (code, responsible, cost) in custom columns, the tooltip and the menu,
          validates changes, logs them, and saves the plan. Scale it up to a portfolio of 80 buildings.
        </p>
        <PowerScenario />
      </section>
    </div>
  );
}
