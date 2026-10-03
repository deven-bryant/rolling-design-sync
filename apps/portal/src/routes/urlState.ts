import { CATEGORIES, type Category, type ChangeFilter, type NodeFilters, type StateFilter } from '../features/nodes';
import type { WorkGroup } from '../features/work';

const STATES: readonly StateFilter[] = ['all', 'dirty', 'clean', 'blocked'];
const CHANGES: readonly ChangeFilter[] = ['added', 'modified', 'deleted'];
const GROUPS: readonly WorkGroup[] = ['component', 'frame'];

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined => values.find(v => v === value);

/** `NodeFilters` from `?q=&state=&change=&category=&type=&expand=instances`. */
export function readNodeFilters(params: URLSearchParams): NodeFilters {
  const filters: NodeFilters = {};
  const q = params.get('q');
  const state = oneOf(STATES, params.get('state'));
  const changeType = oneOf(CHANGES, params.get('change'));
  const category = oneOf<Category>(CATEGORIES, params.get('category'));
  const type = params.get('type');
  if (q) filters.q = q;
  if (state) filters.state = state;
  if (changeType) filters.changeType = changeType;
  if (category) filters.category = category;
  if (type) filters.type = type;
  if (params.get('expand') === 'instances') filters.expandInstances = true;
  return filters;
}

/** `params` with the filter keys replaced by `filters`; other keys (`under`, `node`) are kept. */
export function writeNodeFilters(params: URLSearchParams, filters: NodeFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const values: Record<string, string | undefined> = {
    q: filters.q || undefined,
    state: filters.state && filters.state !== 'all' ? filters.state : undefined,
    change: filters.changeType,
    category: filters.category,
    type: filters.type,
    expand: filters.expandInstances ? 'instances' : undefined,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

export interface WorkState {
  group: WorkGroup;
  /** 1-based. */
  page: number;
}

/** `?group=component|frame&page=<n>`, defaulting to the first page by component. */
export function readWorkState(params: URLSearchParams): WorkState {
  const page = Number(params.get('page'));
  return {
    group: oneOf(GROUPS, params.get('group')) ?? 'component',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function writeWorkState(params: URLSearchParams, { group, page }: WorkState): URLSearchParams {
  const next = new URLSearchParams(params);
  if (group === 'component') next.delete('group');
  else next.set('group', group);
  if (page > 1) next.set('page', String(page));
  else next.delete('page');
  return next;
}

/** `?key=value` for the defined entries, or `''`. */
export function query(values: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const filePath = (fileKey: string, tab?: string) => `/files/${encodeURIComponent(fileKey)}${tab ? `/${tab}` : ''}`;
