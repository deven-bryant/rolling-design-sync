import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiFetch, type ApiResponse } from '../../api/client';
import { useStatus } from '../../api/hooks/useStatus';
import { Button, ButtonUtility } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { Input } from '../../components/Input';
import { Icon, Text } from '../../components/primitives';
import { Select, SelectItem } from '../../components/Select';
import { showToast } from '../../components/Toast';
import { Toggle } from '../../components/Toggle';
import { nodeKeys, useFile, useScope, useSessionRole, type SessionRole } from '../nodes';
import { useScopeChecks } from '../nodes/renderChecks';
import { filesKeys } from './api';

export type FileSettings = NonNullable<ApiResponse<'/v3/files/{fileKey}', 'patch'>['settings']>;
type FileInfo = ApiResponse<'/v3/files/{fileKey}'>;

/** The queries a settings change can affect: work items, nodes, scope counts and the file metrics. */
export function refetchAfterSettings(queryClient: ReturnType<typeof useQueryClient>, fileKey: string): void {
  for (const queryKey of [filesKeys.list, ['files', fileKey], nodeKeys.all(fileKey), nodeKeys.file(fileKey), filesKeys.trends]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** Agent: `PATCH /v3/files/{fileKey}` with `{ settings }`; on success the file's queries are refetched. */
export function useUpdateFileSettings(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: FileSettings) =>
      apiFetch<ApiResponse<'/v3/files/{fileKey}', 'patch'>>('/v3/files/{fileKey}', { method: 'PATCH', path: { fileKey }, body: { settings } }),
    onSuccess: data => {
      queryClient.setQueryData<FileInfo>(nodeKeys.file(fileKey), file => file && { ...file, settings: data.settings });
      refetchAfterSettings(queryClient, fileKey);
    },
  });
}

export interface FileSettingsDrawerProps {
  fileKey: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Overrides the session's role (agents can change settings; viewers see them read-only). */
  role?: SessionRole;
}

type VariantMapping = NonNullable<FileSettings['variantMappings']>[string];
type ThemeMode = NonNullable<FileSettings['themeMode']>;
interface MappingRow {
  id: number;
  property: string;
  as: VariantMapping['as'];
  key: string;
  values: string;
}

const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'color-scheme', label: 'Color scheme (prefers-color-scheme)' },
  { id: 'query', label: 'Query parameter' },
  { id: 'storage', label: 'localStorage key' },
];
export const DEFAULT_RETENTION = 5;

/** `Light=light, Dark=dark` ⇄ `{ Light: 'light', Dark: 'dark' }`. */
export const formatValues = (values: Record<string, string> | undefined) =>
  Object.entries(values ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
export function parseValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of text.split(',')) {
    const [k, ...v] = pair.split('=');
    if (k?.trim() && v.length) out[k.trim()] = v.join('=').trim();
  }
  return out;
}

let rowId = 0;
const toRows = (mappings: FileSettings['variantMappings']): MappingRow[] =>
  Object.entries(mappings ?? {}).map(([property, m]) => ({ id: ++rowId, property, as: m.as, key: m.key ?? '', values: formatValues(m.values) }));

/** Theme, variant mappings, gallery and retention: saved together with *Save*. */
function CheckSettingsForm({ settings, canEdit, onSave, saving }: { settings: FileSettings; canEdit: boolean; onSave: (s: FileSettings) => void; saving: boolean }) {
  const [rows, setRows] = useState<MappingRow[]>(() => toRows(settings.variantMappings));
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode ?? 'color-scheme');
  const [themeKey, setThemeKey] = useState(settings.themeKey ?? 'theme');
  const [urlTemplate, setUrlTemplate] = useState(settings.gallery?.urlTemplate ?? '');
  const [storybookUrl, setStorybookUrl] = useState(settings.gallery?.storybookUrl ?? '');
  const [retention, setRetention] = useState(String(settings.checkRetention ?? DEFAULT_RETENTION));
  const [submitted, setSubmitted] = useState(false);
  const retentionValue = Number(retention);
  const retentionError = Number.isInteger(retentionValue) && retentionValue >= 1 && retentionValue <= 100 ? null : 'Enter a whole number from 1 to 100.';
  const templateError = urlTemplate && !urlTemplate.startsWith('/') && !/^https?:\/\//.test(urlTemplate) ? 'Start with / or http(s)://.' : null;
  const storybookError = storybookUrl && !/^https?:\/\//.test(storybookUrl) ? 'Enter an http(s) URL.' : null;
  const disabled = !canEdit || saving;
  const setRow = (id: number, change: Partial<MappingRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...change } : r)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (retentionError || templateError || storybookError) return;
    const variantMappings: Record<string, VariantMapping> = {};
    for (const r of rows) {
      if (!r.property.trim()) continue;
      variantMappings[r.property.trim()] = { as: r.as, ...(r.as === 'query' && r.key.trim() ? { key: r.key.trim() } : {}), values: parseValues(r.values) };
    }
    onSave({
      variantMappings,
      themeMode,
      themeKey: themeKey.trim() || 'theme',
      gallery: { urlTemplate: urlTemplate.trim() || null, storybookUrl: storybookUrl.trim() || null },
      checkRetention: retentionValue,
    });
  };

  return (
    <form noValidate aria-label="Render check settings" className="flex flex-col gap-3xl" onSubmit={submit}>
      <Drawer.Section title="Variant mappings">
        <Text as="p" color="tertiary">
          How variant properties reach the app: as the theme, or as a query parameter. Variants that differ only in mapped properties share one route.
        </Text>
        <ul className="flex flex-col gap-lg">
          {rows.map((r, i) => (
            <li key={r.id} aria-label={`Mapping ${i + 1}`} className="flex flex-col gap-md rounded-md border border-secondary p-lg">
              <div className="flex items-end gap-md">
                <Input className="flex-1" label="Property" placeholder="Color Mode" value={r.property} onChange={v => setRow(r.id, { property: v })} isDisabled={disabled} />
                <Select
                  className="w-35"
                  label="As"
                  selectedKey={r.as}
                  onSelectionChange={k => k != null && setRow(r.id, { as: String(k) as VariantMapping['as'] })}
                  isDisabled={disabled}
                >
                  <SelectItem id="theme">Theme</SelectItem>
                  <SelectItem id="query">Query</SelectItem>
                </Select>
                {canEdit && (
                  <ButtonUtility
                    hierarchy="tertiary"
                    icon={<Icon name="x-close" />}
                    tooltip={`Remove mapping ${r.property || i + 1}`}
                    onPress={() => setRows(rs => rs.filter(x => x.id !== r.id))}
                    isDisabled={saving}
                  />
                )}
              </div>
              {r.as === 'query' && (
                <Input label="Query key" placeholder={r.property || 'mode'} value={r.key} onChange={v => setRow(r.id, { key: v })} isDisabled={disabled} />
              )}
              <Input label="Values" placeholder="Light=light, Dark=dark" hint="Figma value=app value; values not listed pass through." value={r.values} onChange={v => setRow(r.id, { values: v })} isDisabled={disabled} />
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <Text as="p" color="tertiary">
            No mappings: variant values pass through as-is.
          </Text>
        )}
        {canEdit && (
          <div>
            <Button hierarchy="secondary" size="sm" isDisabled={saving} onPress={() => setRows(rs => [...rs, { id: ++rowId, property: '', as: 'theme', key: '', values: '' }])}>
              Add mapping
            </Button>
          </div>
        )}
      </Drawer.Section>
      <Drawer.Section title="Theme">
        <Select label="Theme mode" selectedKey={themeMode} onSelectionChange={k => k != null && setThemeMode(String(k) as ThemeMode)} isDisabled={disabled}>
          {THEME_MODES.map(m => (
            <SelectItem key={m.id} id={m.id} textValue={m.label}>
              {m.label}
            </SelectItem>
          ))}
        </Select>
        {themeMode !== 'color-scheme' && (
          <Input
            label={themeMode === 'query' ? 'Query parameter' : 'Storage key'}
            value={themeKey}
            onChange={setThemeKey}
            isDisabled={disabled}
            hint={themeMode === 'query' ? 'Adds ?<key>=<theme> to the URL.' : 'Set in localStorage before the page loads.'}
          />
        )}
      </Drawer.Section>
      <Drawer.Section title="Component gallery">
        <Input
          label="Gallery URL template"
          placeholder="/gallery?figma={set}&variant={variant}"
          value={urlTemplate}
          onChange={setUrlTemplate}
          isDisabled={disabled}
          isInvalid={submitted && !!templateError}
          hint={(submitted && templateError) || 'Where component targets render. Placeholders: {key}, {nodeId}, {set}, {variant}, {prop.<Name>}.'}
        />
        <Input
          label="Storybook URL"
          placeholder="https://storybook.example.com"
          value={storybookUrl}
          onChange={setStorybookUrl}
          isDisabled={disabled}
          isInvalid={submitted && !!storybookError}
          hint={(submitted && storybookError) || 'Stories tagged figma:<component key> render their components.'}
        />
      </Drawer.Section>
      <Drawer.Section title="Retention">
        <Input
          label="Results kept per target"
          inputMode="numeric"
          value={retention}
          onChange={setRetention}
          isDisabled={disabled}
          isInvalid={submitted && !!retentionError}
          hint={(submitted && retentionError) || 'Newest first; the last passing result is always kept as the baseline.'}
        />
      </Drawer.Section>
      {canEdit && (
        <div className="flex justify-end">
          <Button hierarchy="primary" size="md" type="submit" loading={saving}>
            Save check settings
          </Button>
        </div>
      )}
    </form>
  );
}

/** One *Checks* toggle per section (`PATCH /v3/files/{fileKey}/scopes/{nodeId}`). */
function SectionChecks({ fileKey, canEdit, disabled }: { fileKey: string; canEdit: boolean; disabled: boolean }) {
  const scopes = (useScope(fileKey, undefined).data?.scopes ?? []).filter(s => s.nodeId !== 'tokens');
  const update = useScopeChecks(fileKey);
  const [error, setError] = useState<string | null>(null);
  if (!scopes.length) return null;
  return (
    <div role="group" aria-label="Sections" className="flex flex-col gap-lg">
      <Text as="p" size="sm" weight="medium" color="secondary">
        Sections
      </Text>
      {scopes.map(scope => (
        <Toggle
          key={scope.nodeId}
          size="sm"
          isSelected={scope.checks !== false}
          isDisabled={!canEdit || disabled || update.isPending}
          onChange={checks =>
            update.mutate(
              { nodeId: scope.nodeId ?? '', checks },
              {
                onSuccess: () => (setError(null), void showToast(checks ? `Checking ${scope.name}` : `${scope.name} is no longer checked`)),
                onError: err => setError(err.message),
              },
            )
          }
          supportingText={scope.checks === false ? 'Not checked' : 'Its screens and components are checked'}
        >
          {scope.name ?? scope.nodeId}
        </Toggle>
      ))}
      {error && (
        <Text as="p" role="alert" color="error-primary">
          {error}
        </Text>
      )}
    </div>
  );
}

/** The *File settings* drawer: the file's settings, editable by agent sessions. */
export function FileSettingsDrawer({ fileKey, isOpen, onOpenChange, role }: FileSettingsDrawerProps) {
  const sessionRole = useSessionRole();
  const canEdit = (role ?? sessionRole) === 'agent';
  const file = useFile(fileKey);
  const status = useStatus();
  const update = useUpdateFileSettings(fileKey);
  const [pending, setPending] = useState<FileSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings: FileSettings = { ...file.data?.settings, ...pending };
  const track = settings.trackLibraryComponents ?? true;
  const auto = settings.autoTargets ?? true;
  const links = status.data?.libraryLinks;

  const save = (next: FileSettings, toast: string) => {
    if (update.isPending) return;
    setPending(next);
    setError(null);
    update.mutate(next, {
      onSuccess: () => showToast(toast),
      onError: err => setError(err.message),
      onSettled: () => setPending(null),
    });
  };

  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange} aria-label="File settings">
      <Drawer.Header title="File settings" description={file.data?.name ?? fileKey} />
      <Drawer.Body>
        {!canEdit && (
          <Text as="p" color="tertiary">
            Sign in with an agent token to change file settings.
          </Text>
        )}
        {error && (
          <Text as="p" role="alert" color="error-primary">
            {error}
          </Text>
        )}
        <Drawer.Section title="Library components">
          <Toggle
            size="md"
            isSelected={track}
            isDisabled={!canEdit || !file.data}
            onChange={next =>
              save({ trackLibraryComponents: next }, next ? 'Library components are tracked' : 'Library components are no longer tracked')
            }
            supportingText="Scan the library components your designs use and list their changes as work. Turn off when your code gets these components from a package or another repository; instances stay tracked either way."
          >
            Track library components
          </Toggle>
          {links !== undefined && (
            <Text as="p" color="tertiary">
              Links to library files: {links ? 'on' : 'off (set RDS_FIGMA_TOKEN on the server)'}
            </Text>
          )}
        </Drawer.Section>
        <Drawer.Section title="Render checks">
          <Toggle
            size="md"
            isSelected={auto}
            isDisabled={!canEdit || !file.data}
            onChange={next => save({ autoTargets: next }, next ? 'Check targets are detected automatically' : 'Only screens set up by hand are checked')}
            supportingText="Check every checked section’s top-level frames, components and instances, each variant of its component sets and every main component in it. Off: only screens set up by hand."
          >
            Auto-detect check targets
          </Toggle>
          <SectionChecks fileKey={fileKey} canEdit={canEdit} disabled={!auto} />
        </Drawer.Section>
        {file.data && (
          <CheckSettingsForm
            key={JSON.stringify(file.data.settings ?? {})}
            settings={file.data.settings ?? {}}
            canEdit={canEdit}
            saving={update.isPending}
            onSave={next => save(next, 'Check settings saved')}
          />
        )}
      </Drawer.Body>
    </Drawer>
  );
}
