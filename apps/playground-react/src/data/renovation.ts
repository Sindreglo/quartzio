import type { ProjectInput } from '@quartzio/gantt';

/**
 * A kitchen renovation, as an everyday user would enter it: a handful of phases, tasks that follow each other,
 * two milestones and a delivery that takes a few weeks. No calendars, constraints or manual scheduling.
 */
export const kitchenRenovation: ProjectInput = {
  settings: { startDate: '2026-09-21' },
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        { id: 'measure', name: 'Measure the kitchen', duration: 1, percentDone: 100 },
        { id: 'design', name: 'Choose layout and cabinets', duration: 5, percentDone: 80 },
        { id: 'quotes', name: 'Get quotes from contractors', duration: 4, percentDone: 50 },
        { id: 'order', name: 'Order cabinets and appliances', duration: 1 },
        { id: 'ordered', name: 'Order confirmed', duration: 0 },
      ],
    },
    {
      id: 'demolition',
      name: 'Demolition',
      children: [
        { id: 'disconnect', name: 'Disconnect water and power', duration: 1 },
        { id: 'remove', name: 'Remove old cabinets and floor', duration: 2 },
      ],
    },
    {
      id: 'rough',
      name: 'Rough work',
      children: [
        { id: 'electrical', name: 'New electrical outlets', duration: 3 },
        { id: 'plumbing', name: 'Move the sink plumbing', duration: 2 },
        { id: 'walls', name: 'Repair walls and ceiling', duration: 4 },
        { id: 'floor', name: 'Lay the new floor', duration: 3 },
      ],
    },
    {
      id: 'install',
      name: 'Installation',
      children: [
        { id: 'delivery', name: 'Cabinets delivered', duration: 0 },
        { id: 'cabinets', name: 'Install cabinets', duration: 3 },
        { id: 'countertop', name: 'Countertop and sink', duration: 1 },
        { id: 'appliances', name: 'Connect appliances', duration: 1 },
        { id: 'tiles', name: 'Backsplash tiles', duration: 2 },
        { id: 'paint', name: 'Paint', duration: 2 },
      ],
    },
    { id: 'done', name: 'Kitchen ready', duration: 0 },
  ],
  dependencies: [
    { id: 'd1', from: 'measure', to: 'design' },
    { id: 'd2', from: 'measure', to: 'quotes' },
    { id: 'd3', from: 'design', to: 'order' },
    { id: 'd4', from: 'quotes', to: 'order' },
    { id: 'd5', from: 'order', to: 'ordered' },
    // The cabinets take three weeks to arrive.
    { id: 'd6', from: 'ordered', to: 'delivery', lag: 3, lagUnit: 'week' },
    { id: 'd7', from: 'ordered', to: 'disconnect' },
    { id: 'd8', from: 'disconnect', to: 'remove' },
    { id: 'd9', from: 'remove', to: 'electrical' },
    { id: 'd10', from: 'remove', to: 'plumbing' },
    { id: 'd11', from: 'electrical', to: 'walls' },
    { id: 'd12', from: 'plumbing', to: 'walls' },
    { id: 'd13', from: 'walls', to: 'floor' },
    { id: 'd14', from: 'floor', to: 'cabinets' },
    { id: 'd15', from: 'delivery', to: 'cabinets' },
    { id: 'd16', from: 'cabinets', to: 'countertop' },
    { id: 'd17', from: 'countertop', to: 'appliances' },
    { id: 'd18', from: 'countertop', to: 'tiles' },
    { id: 'd19', from: 'tiles', to: 'paint' },
    { id: 'd20', from: 'appliances', to: 'done' },
    { id: 'd21', from: 'paint', to: 'done' },
  ],
};

/** The code an everyday user writes, shown in the demo. */
export const kitchenRenovationCode = `import { Gantt } from '@quartzio/gantt-react';
import '@quartzio/gantt-react/styles.css';

<Gantt defaultData={kitchenRenovation} style={{ height: 480 }} />`;
