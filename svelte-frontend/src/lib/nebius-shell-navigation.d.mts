export const TASK_LOCATION_CONTEXT: 'nebius:task-location';
export interface TaskLocation { id: string; view: string; }
export type TaskLocationSink = (location: TaskLocation | null) => void;
export interface ShellNavigationOptions {
  taskHref?: string;
  pathname?: string;
  currentView?: string;
}
export interface ShellNavigationItem {
  label: string;
  href: string;
  current: boolean;
  detail: boolean;
}
export function taskNavigationHref(value: unknown): string;
export function shellNavigation(options?: ShellNavigationOptions): ShellNavigationItem[];
export function isPlainNavigationClick(event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean;
