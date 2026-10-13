import { useEffect, useState, type ReactNode } from 'react';
import { Input } from '../../components/Input';
import { Toggle } from '../../components/Toggle';
import { Icon } from '../../components/primitives';
import { SEARCH_DEBOUNCE_MS } from '../nodes';

export interface WorkFilters {
  /** The search box (name, node id or `key:value`), as on Nodes. */
  q?: string;
  /** *Expand instances*: list the components the scope's instances use (`expand=instances`). */
  expandInstances: boolean;
}

export interface WorkFiltersBarProps {
  filters: WorkFilters;
  onFiltersChange: (filters: WorkFilters) => void;
  /** Shown beside the search field, e.g. the *N Scopes Viewed* badge. */
  addon?: ReactNode;
  /** The group switch, on the second row opposite *Expand instances*. */
  groupSwitch?: ReactNode;
}

/** The Work Items filter row: node search, an addon and *Expand instances*, wired like the Nodes filters. */
export function WorkFiltersBar({ filters, onFiltersChange, addon, groupSwitch }: WorkFiltersBarProps) {
  const q = filters.q ?? '';
  const [draft, setDraft] = useState(q);
  const [committed, setCommitted] = useState(q);
  if (q !== committed) {
    setCommitted(q);
    setDraft(q);
  }
  useEffect(() => {
    if (draft === q) return undefined;
    const timer = setTimeout(() => onFiltersChange({ ...filters, q: draft.trim() ? draft : undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, q, filters, onFiltersChange]);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center gap-lg">
        <Input
          aria-label="Search nodes"
          className="w-70"
          type="search"
          placeholder="Search name, node id, or key:value"
          tooltip="Plain text matches node names anywhere in the scope, a node id lists that node, and key:value pairs (state:dirty changed:fills) filter like the API's q. Separate several names or node ids with commas: Button, Pagination."
          iconLeading={<Icon name="search-lg" size="md" />}
          value={draft}
          onChange={setDraft}
        />
        {addon}
      </div>
      <div className="flex flex-wrap items-center gap-lg">
        {groupSwitch}
        <Toggle
          className="ml-auto shrink-0"
          isSelected={filters.expandInstances}
          onChange={expandInstances => onFiltersChange({ ...filters, expandInstances })}
        >
          Expand instances
        </Toggle>
      </div>
    </div>
  );
}
