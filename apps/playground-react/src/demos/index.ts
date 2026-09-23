import type { ComponentType } from 'react';
import { BasicDemo } from './basic';

export interface Demo {
  /** Used in the URL hash, e.g. #basic */
  id: string;
  title: string;
  description: string;
  Component: ComponentType;
}

// One demo per feature. Register new demos here so they show up in the menu.
export const demos: Demo[] = [
  {
    id: 'basic',
    title: 'Basic',
    description: 'The Gantt component with default options.',
    Component: BasicDemo,
  },
];
