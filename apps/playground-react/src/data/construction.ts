import type {
  CalendarInput,
  DependencyInput,
  DependencyType,
  Id,
  ProjectInput,
  TaskInput,
} from '@quartzio/gantt';

/** What the contractor's own system knows about a work package, beyond what the chart shows. */
export interface WorkPackage {
  readonly code: string;
  readonly owner: string;
  /** Estimated cost in NOK. */
  readonly cost: number;
}

/** Working days 07:00–15:00 with a half-hour lunch (7.5 hours), Norwegian public holidays and the builders' holiday. */
export const norwegianBuildingCalendar: CalendarInput = {
  id: 'building',
  name: 'Norwegian building site',
  week: Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => [
      day,
      [
        { start: '07:00', end: '11:00' },
        { start: '11:30', end: '15:00' },
      ],
    ]),
  ),
  exceptions: [
    { startDate: '2026-12-24', endDate: '2027-01-01', name: 'Christmas and New Year' },
    { startDate: '2027-03-25', endDate: '2027-03-29', name: 'Easter' },
    { startDate: '2027-05-06', name: 'Ascension Day' },
    { startDate: '2027-05-17', name: 'Constitution Day and Whit Monday' },
    { startDate: '2027-07-05', endDate: '2027-07-23', name: "Builders' holiday" },
    { startDate: '2027-12-24', endDate: '2028-01-01', name: 'Christmas and New Year' },
    { startDate: '2028-04-13', endDate: '2028-04-17', name: 'Easter' },
    { startDate: '2028-05-01', name: 'Labour Day' },
    { startDate: '2028-05-17', name: 'Constitution Day' },
    { startDate: '2028-05-25', name: 'Ascension Day' },
    { startDate: '2028-06-05', name: 'Whit Monday' },
    { startDate: '2028-07-03', endDate: '2028-07-21', name: "Builders' holiday" },
  ],
};

const DAY_RATES: Record<string, number> = {
  'Nordic Architects': 14_000,
  'Owner (Fjord Estates)': 9_000,
  'Groundworks Ltd': 42_000,
  'Concrete & Steel': 55_000,
  'Oslo Steel Supply': 0,
  'Facade Systems': 38_000,
  'Carpentry Crew': 24_000,
  'Northern Electric': 21_000,
  'Pipe Partners': 19_000,
  'Vent Air': 23_000,
  'Painters United': 12_000,
  'Floor Masters': 15_000,
  'Lift & Co': 30_000,
  'Heating Systems': 26_000,
  'Green Outdoors': 17_000,
  'Commissioning Team': 20_000,
};

const TRADES = [
  { key: 'partitions', name: 'Partition walls', days: 6, owner: 'Carpentry Crew' },
  { key: 'electrical', name: 'Electrical rough-in', days: 5, owner: 'Northern Electric' },
  { key: 'plumbing', name: 'Plumbing rough-in', days: 5, owner: 'Pipe Partners' },
  { key: 'ventilation', name: 'Ventilation ducts', days: 6, owner: 'Vent Air' },
  { key: 'drywall', name: 'Drywall and ceilings', days: 5, owner: 'Carpentry Crew' },
  { key: 'painting', name: 'Painting', days: 4, owner: 'Painters United' },
  { key: 'flooring', name: 'Flooring', days: 4, owner: 'Floor Masters' },
  { key: 'fixtures', name: 'Fixtures and fittings', days: 3, owner: 'Northern Electric' },
] as const;

/**
 * An office building (or a portfolio of them) as a contractor plans it: design and permits, groundworks, a
 * concrete frame floor by floor, the envelope, the interior trade by trade on every floor, technical systems,
 * outdoor works and handover. Uses every dependency type with lags, milestones, manually scheduled deliveries
 * and "start no earlier than" constraints. About 120 tasks per building.
 */
export function constructionProgram(
  buildings: number,
  floors = 8,
): { project: ProjectInput; packages: ReadonlyMap<Id, WorkPackage> } {
  const packages = new Map<Id, WorkPackage>();
  const dependencies: DependencyInput[] = [];
  let dependencyCount = 0;
  const link = (from: Id, to: Id, type: DependencyType = 'FS', lag = 0) => {
    dependencies.push({ id: `L${String(++dependencyCount)}`, from, to, type, ...(lag === 0 ? {} : { lag }) });
  };

  const tasks: TaskInput[] = [];
  for (let b = 0; b < buildings; b++) {
    const p = buildings === 1 ? '' : `B${String(b + 1)}-`;
    const code = (parts: number[]) => (buildings === 1 ? parts : [b + 1, ...parts]).join('.');
    const task = (
      id: string,
      name: string,
      days: number,
      owner: string,
      parts: number[],
      extra: Partial<TaskInput> = {},
    ): TaskInput => {
      packages.set(p + id, { code: code(parts), owner, cost: days * (DAY_RATES[owner] ?? 0) });
      return { id: p + id, name, duration: days, ...extra };
    };
    const group = (id: string, name: string, parts: number[], children: TaskInput[]): TaskInput => {
      const cost = children.reduce((sum, child) => sum + (packages.get(child.id)?.cost ?? 0), 0);
      packages.set(p + id, { code: code(parts), owner: '', cost });
      return { id: p + id, name, children };
    };
    const id = (local: string) => p + local;
    // Buildings in a portfolio start a month apart (the design team can't do them all at once).
    const month = String(((8 + b) % 12) + 1).padStart(2, '0');
    const year = 2026 + Math.floor((8 + b) / 12);

    const design = group(
      'design',
      'Design and permits',
      [1],
      [
        task('concept', 'Concept design', 15, 'Nordic Architects', [1, 1], {
          percentDone: b === 0 ? 100 : 0,
          ...(b === 0
            ? {}
            : { constraintType: 'startnoearlierthan', constraintDate: `${String(year)}-${month}-01` }),
        }),
        task('detailed', 'Detailed design', 30, 'Nordic Architects', [1, 2], {
          percentDone: b === 0 ? 35 : 0,
        }),
        task('application', 'Building permit application', 5, 'Owner (Fjord Estates)', [1, 3]),
        // The municipality won't decide before mid-November, however early the application is.
        task('permit', 'Building permit granted', 0, 'Owner (Fjord Estates)', [1, 4], {
          constraintType: 'startnoearlierthan',
          constraintDate: b === 0 ? '2026-11-16' : `${String(year + 1)}-0${String((b % 3) + 1)}-15`,
        }),
        task('tender', 'Tender and contracts', 20, 'Owner (Fjord Estates)', [1, 5]),
      ],
    );
    link(id('concept'), id('detailed'));
    link(id('detailed'), id('application'), 'SS', 10);
    link(id('application'), id('permit'));
    link(id('detailed'), id('tender'), 'SS', 15);

    const site = group(
      'site',
      'Site setup',
      [2],
      [
        task('establish', 'Site establishment', 5, 'Groundworks Ltd', [2, 1]),
        task('temporary', 'Temporary power and water', 3, 'Northern Electric', [2, 2]),
      ],
    );
    link(id('permit'), id('establish'));
    link(id('tender'), id('establish'));
    link(id('establish'), id('temporary'), 'SS', 2);

    const ground = group(
      'ground',
      'Groundworks',
      [3],
      [
        task('excavation', 'Excavation', 15, 'Groundworks Ltd', [3, 1]),
        task('foundations', 'Foundations', 20, 'Concrete & Steel', [3, 2]),
        task('basement', 'Basement walls', 15, 'Concrete & Steel', [3, 3]),
        task('drainage', 'Drainage', 8, 'Groundworks Ltd', [3, 4]),
      ],
    );
    link(id('establish'), id('excavation'));
    link(id('excavation'), id('foundations'));
    link(id('foundations'), id('basement'));
    link(id('excavation'), id('drainage'), 'SS', 5);

    const frame: TaskInput[] = [
      // A delivery window agreed with the supplier: fixed dates, whatever the rest of the plan does.
      task('steel', 'Steel delivery', 10, 'Oslo Steel Supply', [4, 1], {
        manuallyScheduled: true,
        startDate: b === 0 ? '2027-02-01T07:00' : `${String(year + 1)}-0${String((b % 5) + 3)}-01T07:00`,
      }),
    ];
    for (let f = 1; f <= floors; f++) {
      frame.push(
        task(`floor${String(f)}`, `Floor ${String(f)}: columns and slab`, 8, 'Concrete & Steel', [4, f + 1]),
      );
      link(f === 1 ? id('basement') : id(`floor${String(f - 1)}`), id(`floor${String(f)}`));
    }
    link(id('steel'), id('floor1'));
    frame.push(task('topping', 'Topping out', 0, 'Concrete & Steel', [4, floors + 2]));
    link(id(`floor${String(floors)}`), id('topping'));
    const structure = group('structure', 'Structure', [4], frame);

    const envelope = group(
      'envelope',
      'Envelope',
      [5],
      [
        task('roof', 'Roof', 10, 'Facade Systems', [5, 1]),
        task('facade', 'Facade', 25, 'Facade Systems', [5, 2]),
        task('windows', 'Windows', 20, 'Facade Systems', [5, 3]),
        task('weathertight', 'Weathertight', 0, 'Facade Systems', [5, 4]),
      ],
    );
    link(id('topping'), id('roof'));
    link(id(`floor${String(Math.min(3, floors))}`), id('facade'), 'SS', 5);
    link(id('facade'), id('windows'), 'SS', 5);
    link(id('roof'), id('weathertight'));
    link(id('windows'), id('weathertight'), 'FF');

    const interiors: TaskInput[] = [];
    for (let f = 1; f <= floors; f++) {
      const floorTasks = TRADES.map((trade, t) =>
        task(`f${String(f)}-${trade.key}`, trade.name, trade.days, trade.owner, [6, f, t + 1]),
      );
      interiors.push(group(`interior${String(f)}`, `Floor ${String(f)} interior`, [6, f], floorTasks));
      const at = (key: string) => id(`f${String(f)}-${key}`);
      link(id('weathertight'), at('partitions'));
      link(id(`floor${String(f)}`), at('partitions'));
      link(at('partitions'), at('electrical'), 'SS', 2);
      link(at('partitions'), at('plumbing'), 'SS', 2);
      link(at('partitions'), at('ventilation'), 'SS', 3);
      link(at('electrical'), at('drywall'));
      link(at('plumbing'), at('drywall'));
      link(at('ventilation'), at('drywall'));
      link(at('drywall'), at('painting'));
      link(at('painting'), at('flooring'));
      link(at('flooring'), at('fixtures'), 'FF', 1);
      // The painters move up one floor at a time.
      if (f > 1) link(id(`f${String(f - 1)}-painting`), at('painting'));
    }
    const interior = group('interior', 'Interior', [6], interiors);

    const technical = group(
      'technical',
      'Technical systems',
      [7],
      [
        task('lift', 'Lift installation', 15, 'Lift & Co', [7, 1], {
          constraintType: 'startnoearlierthan',
          constraintDate: b === 0 ? '2027-04-05' : `${String(year + 1)}-09-01`,
        }),
        task('heating', 'Heating plant', 10, 'Heating Systems', [7, 2]),
        task('tempheat', 'Temporary heating', 20, 'Heating Systems', [7, 3]),
        task('bms', 'Building management system', 8, 'Northern Electric', [7, 4]),
      ],
    );
    link(id('weathertight'), id('lift'));
    link(id('weathertight'), id('heating'));
    link(id('roof'), id('tempheat'));
    // The temporary heating runs until the permanent plant starts.
    link(id('heating'), id('tempheat'), 'SF');
    link(id('heating'), id('bms'), 'SS', 5);

    const outdoor = group(
      'outdoor',
      'Outdoor works',
      [8],
      [
        task('landscaping', 'Landscaping', 15, 'Green Outdoors', [8, 1]),
        task('parking', 'Parking and roads', 10, 'Groundworks Ltd', [8, 2]),
      ],
    );
    link(id('facade'), id('landscaping'), 'SS', 10);
    link(id('landscaping'), id('parking'), 'SS', 5);

    const handover = group(
      'handover',
      'Handover',
      [9],
      [
        task('commissioning', 'Testing and commissioning', 10, 'Commissioning Team', [9, 1]),
        task('inspection', 'Final inspection', 2, 'Owner (Fjord Estates)', [9, 2]),
        task('certificate', 'Certificate of completion', 0, 'Owner (Fjord Estates)', [9, 3]),
        task('handoverDone', 'Handover to tenant', 0, 'Owner (Fjord Estates)', [9, 4]),
      ],
    );
    for (let f = 1; f <= floors; f++) link(id(`f${String(f)}-fixtures`), id('commissioning'));
    link(id('lift'), id('commissioning'));
    link(id('bms'), id('commissioning'));
    link(id('commissioning'), id('inspection'));
    link(id('inspection'), id('certificate'));
    link(id('parking'), id('handoverDone'));
    link(id('certificate'), id('handoverDone'));

    const phases = [design, site, ground, structure, envelope, interior, technical, outdoor, handover];
    if (buildings === 1) tasks.push(...phases);
    else tasks.push(group('building', `Building ${String(b + 1)}`, [], phases));
  }

  return {
    project: {
      settings: {
        timeZone: 'Europe/Oslo',
        startDate: '2026-08-17',
        calendarId: 'building',
        hoursPerDay: 7.5,
      },
      calendars: [norwegianBuildingCalendar],
      tasks,
      dependencies,
    },
    packages,
  };
}
