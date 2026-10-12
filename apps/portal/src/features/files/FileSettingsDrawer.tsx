import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, type ApiResponse } from '../../api/client';
import { useStatus } from '../../api/hooks/useStatus';
import { Drawer } from '../../components/Drawer';
import { Text } from '../../components/primitives';
import { showToast } from '../../components/Toast';
import { Toggle } from '../../components/Toggle';
import { nodeKeys, useFile, useSessionRole, type SessionRole } from '../nodes';
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

/** The *File settings* drawer: the file's settings, editable by agent sessions. */
export function FileSettingsDrawer({ fileKey, isOpen, onOpenChange, role }: FileSettingsDrawerProps) {
  const sessionRole = useSessionRole();
  const canEdit = (role ?? sessionRole) === 'agent';
  const file = useFile(fileKey);
  const status = useStatus();
  const update = useUpdateFileSettings(fileKey);
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stored = file.data?.settings?.trackLibraryComponents ?? true;
  const track = pending ?? stored;
  const links = status.data?.libraryLinks;

  const change = (next: boolean) => {
    setPending(next);
    setError(null);
    update.mutate(
      { trackLibraryComponents: next },
      {
        onSuccess: () => showToast(next ? 'Library components are tracked' : 'Library components are no longer tracked'),
        onError: err => setError(err.message),
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange} aria-label="File settings">
      <Drawer.Header title="File settings" description={file.data?.name ?? fileKey} />
      <Drawer.Body>
        <Drawer.Section title="Library components">
          <Toggle
            size="md"
            isSelected={track}
            isDisabled={!canEdit || !file.data || update.isPending}
            onChange={change}
            supportingText="Scan the library components your designs use and list their changes as work. Turn off when your code gets these components from a package or another repository; instances stay tracked either way."
          >
            Track library components
          </Toggle>
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
          {links !== undefined && (
            <Text as="p" color="tertiary">
              Links to library files: {links ? 'on' : 'off (set RDS_FIGMA_TOKEN on the server)'}
            </Text>
          )}
        </Drawer.Section>
      </Drawer.Body>
    </Drawer>
  );
}
