export interface ProjectNavigationTask {
  id: string;
  title: string;
  href: string;
  current: boolean;
  status: string;
  archived: boolean;
}
export interface ProjectNavigationModel {
  project: { id: string; title: string } | null;
  scopeLabel: string;
  scopeKey: string;
  tasks: ProjectNavigationTask[];
  allWork: { label: 'All work'; href: '/work?scope=all' };
}
export interface ProjectNavigationOptions {
  packs?: readonly { id: string; title?: string; projectId?: string; status?: string; archived?: boolean }[];
  projects?: readonly { id: string; title: string }[];
  selectedProjectId?: string | null;
  currentTaskId?: string | null;
  pathname?: string;
  orderedIds?: readonly string[];
}
export function projectNavigation(options?: ProjectNavigationOptions): ProjectNavigationModel;
export function filterCommandNavigation(model: ProjectNavigationModel, query?: string): ProjectNavigationModel & { matched: number; total: number };
