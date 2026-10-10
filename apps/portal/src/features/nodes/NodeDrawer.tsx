import { useEffect, useState, type ReactNode } from 'react';
import { useFileClaims } from '../../api/hooks/useFileClaims';
import { useNow } from '../../api/hooks/useNow';
import { Avatar } from '../../components/Avatar';
import { Badge, type BadgeProps } from '../../components/Badge';
import { Button, CloseButton } from '../../components/Button';
import { Drawer } from '../../components/Drawer';
import { agentInitials } from '../../components/domain/AgentSprite';
import { ChangeBadge } from '../../components/domain/ChangeBadge';
import {
  NodeDetails,
  type NodeDetailsChange,
  type NodeDetailsEvent,
  type NodeDetailsState,
  type NodeDetailsValue,
} from '../../components/domain/NodeDetails';
import { StateBadge } from '../../components/domain/StateBadge';
import { Input } from '../../components/Input';
import { Menu } from '../../components/Menu';
import { Text } from '../../components/primitives';
import { categoriesOf, type Category } from './categories';
import { changeEntries, formatValue, isTokenValue, nodePrompt, plural, sideLabel, timeAgo, timeUntil } from './format';
import { useBlockNode, useNodeDetail, useNodeHistory, useReleaseClaim, useSessionRole, useUnblockNode } from './queries';
import type { FileEvent, NodeDetail, SessionRole } from './types';

/** A block reason's length bounds (the API's). */
export const BLOCK_REASON_MAX = 500;

export function blockReasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (!length) return 'Enter why this node can’t be implemented.';
  if (length > BLOCK_REASON_MAX) return `Keep the reason to ${BLOCK_REASON_MAX} characters (${length} now).`;
  return null;
}

const short = (ref: string) => (/^[0-9a-f]{8,}$/i.test(ref) ? ref.slice(0, 7) : ref);

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** One history line for a node event. */
export function describeEvent(event: FileEvent): string {
  const data = record(event.data);
  switch (event.type) {
    case 'claim.created': {
      const others = Math.max(0, (typeof data.nodeCount === 'number' ? data.nodeCount : 1) - 1);
      const lease =
        typeof data.expiresAt === 'string' && event.createdAt
          ? Math.round((Date.parse(data.expiresAt) - Date.parse(event.createdAt)) / 60_000)
          : NaN;
      return `Claimed this node${others ? ` with ${plural(others, 'other', 'others')}` : ''}${Number.isFinite(lease) && lease > 0 ? ` (lease ${lease} min)` : ''}.`;
    }
    case 'claim.renewed':
      return 'Renewed the claim.';
    case 'claim.released':
      return 'Released the claim.';
    case 'nodes.cleared':
      return typeof data.commitRef === 'string' && data.commitRef ? `Cleared it as implemented at ${short(data.commitRef)}.` : 'Cleared it as implemented.';
    case 'node.blocked':
      return typeof data.reason === 'string' && data.reason ? `Blocked it: ${data.reason}` : 'Blocked it.';
    case 'node.unblocked':
      return 'Unblocked it.';
    case 'sync.completed':
      return 'Synced the design from Figma.';
    default:
      return event.type ?? 'Event';
  }
}

function changedSince(node: NodeDetail, now: number): string | undefined {
  const { implementedCommit, implementedAt } = node.history ?? {};
  if (implementedCommit) return `Since it was last cleared at ${short(implementedCommit)}${implementedAt ? ` (${timeAgo(implementedAt, now)})` : ''}`;
  if (implementedAt) return `Since it was last cleared ${timeAgo(implementedAt, now)}`;
  if (node.changeType === 'added') return 'New — never cleared';
  return undefined;
}

/** A change side as a `Change List` cell: the token's name over its raw value, or just the raw value. */
const changeValue = (side: unknown): NodeDetailsValue =>
  isTokenValue(side) ? { value: sideLabel(side), detail: formatValue(side) } : { value: formatValue(side) };

function changeRows(node: NodeDetail): NodeDetailsChange[] {
  return changeEntries(node).map(([prop, change]) => ({ attribute: prop, from: changeValue(change.built), to: changeValue(change.now) }));
}

const CATEGORY_COLORS: Record<Category, NonNullable<BadgeProps['color']>> = {
  layout: 'blue-light',
  color: 'indigo',
  typography: 'blue',
  effects: 'pink',
  component: 'orange',
  content: 'gray-blue',
  structure: 'gray-blue',
  prototype: 'gray-blue',
  other: 'gray',
};

interface ClaimProps {
  claimSubtitle: ReactNode;
  claimNote?: ReactNode;
  claimAction?: ReactNode;
  claimContent?: ReactNode;
}

function useClaim({ fileKey, node, canAct, now }: { fileKey: string; node: NodeDetail; canAct: boolean; now: number }): ClaimProps {
  const claims = useFileClaims(fileKey);
  const release = useReleaseClaim(fileKey);
  const [confirming, setConfirming] = useState(false);
  const claim = node.claim;
  const full = claim?.claimId ? claims.data?.claims?.find(c => c.claimId === claim.claimId) : undefined;
  const others = Math.max(0, (full?.nodeCount ?? 1) - 1);

  if (!claim?.worker) return { claimSubtitle: 'Not claimed. Agents claim nodes before they implement them.' };

  const doRelease = () => {
    if (!claim.claimId) return;
    release.mutate(claim.claimId, { onSuccess: () => setConfirming(false) });
  };
  const parts = [
    claim.worker,
    full?.createdAt ? `claimed ${timeAgo(full.createdAt, now)}` : 'claimed',
    claim.expiresAt ? `lease expires ${timeUntil(claim.expiresAt, now)}` : null,
  ].filter(Boolean);
  const note = [claim.label, others > 0 ? `covers ${plural(others, 'other node', 'other nodes')} too` : null].filter(Boolean).join(' · ');
  return {
    claimSubtitle: parts.join(' · '),
    claimNote: note || undefined,
    claimAction: canAct && !confirming && (
      <Button hierarchy="secondary" size="sm" loading={release.isPending} onPress={() => (others > 0 ? setConfirming(true) : doRelease())}>
        Release claim
      </Button>
    ),
    claimContent: (
      <>
        {canAct && confirming && (
          <div role="alertdialog" aria-label="Release the whole claim?" className="flex flex-col gap-lg rounded-lg border border-secondary bg-secondary p-xl">
            <Text color="secondary">
              This claim also covers {plural(others, 'other node', 'other nodes')}. Releasing it frees all {others + 1} for other agents.
            </Text>
            <div className="flex justify-end gap-lg">
              <Button hierarchy="secondary" size="sm" onPress={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button hierarchy="primary" size="sm" loading={release.isPending} onPress={doRelease}>
                Release {others + 1} nodes
              </Button>
            </div>
          </div>
        )}
        {release.isError && <Text color="error-primary">{release.error.message}</Text>}
      </>
    ),
  };
}

function BlockForm({ fileKey, nodeId, onDone }: { fileKey: string; nodeId: string; onDone: () => void }) {
  const block = useBlockNode(fileKey);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const error = blockReasonError(reason);
  const submit = () => {
    setSubmitted(true);
    if (error) return;
    block.mutate({ nodeId, reason: reason.trim() }, { onSuccess: onDone });
  };
  return (
    <Drawer.Section title="Block this node" subtitle="Say why it can’t be implemented and what would unblock it.">
      <form
        noValidate
        className="flex flex-col gap-lg"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Reason"
          required
          autoFocus
          value={reason}
          onChange={setReason}
          isInvalid={submitted && !!error}
          hint={submitted && error ? error : `${reason.trim().length}/${BLOCK_REASON_MAX}`}
        />
        {block.isError && <Text color="error-primary">{block.error.message}</Text>}
        <div className="flex justify-end gap-lg">
          <Button hierarchy="secondary" size="sm" onPress={onDone}>
            Cancel
          </Button>
          <Button hierarchy="primary" size="sm" type="submit" loading={block.isPending}>
            Block node
          </Button>
        </div>
      </form>
    </Drawer.Section>
  );
}

function useHistory(fileKey: string, nodeId: string, now: number): { history: NodeDetailsEvent[]; historyEmpty: ReactNode } {
  const query = useNodeHistory(fileKey, nodeId);
  const history = (query.data?.events ?? []).map(event => {
    const actor = event.actor ?? 'system';
    return {
      id: event.id ?? `${event.type}-${event.createdAt}`,
      avatar: <Avatar size="lg" initials={agentInitials(actor)} alt={actor} />,
      name: actor,
      time: timeAgo(event.createdAt, now),
      dateTime: event.createdAt,
      children: describeEvent(event),
    };
  });
  let historyEmpty: ReactNode = 'No history yet.';
  if (query.isPending) historyEmpty = 'Loading history…';
  else if (query.isError) historyEmpty = <Text color="error-primary">Couldn’t load history: {query.error.message}</Text>;
  return { history, historyEmpty };
}

function CopyPromptButton({ fileKey, node }: { fileKey: string; node: NodeDetail }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = setTimeout(() => setCopied('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    const text = nodePrompt({ fileKey, nodeId: node.nodeId ?? '', name: node.name });
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Clipboard unavailable'));
    write.then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    );
  };
  return (
    <Button hierarchy="tertiary" size="sm" onPress={copy}>
      <span aria-live="polite">{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy node prompt'}</span>
    </Button>
  );
}

interface TabProps {
  tab: NodeDetailsState;
  onTabChange: (tab: NodeDetailsState) => void;
}

function NodeDrawerContent({ fileKey, nodeId, role, ...tab }: { fileKey: string; nodeId: string; role: SessionRole } & TabProps) {
  const detail = useNodeDetail(fileKey, nodeId);
  const node = detail.data;
  if (!node) {
    return (
      <>
        <Drawer.Header title={nodeId} description={detail.isError ? 'Couldn’t load this node' : 'Loading…'} />
        <Drawer.Body>
          {detail.isError ? <Text color="error-primary">{detail.error.message}</Text> : <Text color="tertiary">Loading node…</Text>}
        </Drawer.Body>
      </>
    );
  }
  return <LoadedNode fileKey={fileKey} nodeId={nodeId} node={node} role={role} {...tab} />;
}

function LoadedNode({
  fileKey,
  nodeId,
  node,
  role,
  tab,
  onTabChange,
}: { fileKey: string; nodeId: string; node: NodeDetail; role: SessionRole } & TabProps) {
  const unblock = useUnblockNode(fileKey);
  const now = useNow(30_000);
  const [blocking, setBlocking] = useState(false);
  const canAct = role === 'agent';
  const claim = useClaim({ fileKey, node, canAct, now });
  const { history, historyEmpty } = useHistory(fileKey, nodeId, now);

  const main = node.isInstance && node.mainComponentId ? ` → main ${node.mainComponentId}` : '';
  const categories = categoriesOf(node.changedProps ?? []);
  const blocked = node.state === 'blocked' || !!node.blocked;
  return (
    <>
      <NodeDetails
        className="min-h-0 flex-1 overflow-y-auto"
        state={tab}
        onStateChange={onTabChange}
        title={node.name ?? nodeId}
        description={`${node.type ?? 'NODE'} · ${node.nodeId ?? nodeId}${main}`}
        actions={<CloseButton slot="close" size="md" aria-label="Close" />}
        status={
          <>
            {node.state && <StateBadge state={node.state} size="md" dot={false} />}
            {node.changeType && <ChangeBadge change={node.changeType} size="md" />}
            {categories.map(category => (
              <Badge key={category} size="md" color={CATEGORY_COLORS[category]}>
                {category}
              </Badge>
            ))}
          </>
        }
        {...claim}
        changes={node.changesKnown === false ? [] : changeRows(node)}
        changesDescription={changedSince(node, now)}
        changesEmpty={
          node.changesKnown === false
            ? 'The property changes aren’t known for this node (it has no built baseline).'
            : 'Nothing changed since it was last cleared.'
        }
        changesMenu={
          node.figmaUrl && (
            <Menu label="Change list actions">
              <Menu.Item id="figma" href={node.figmaUrl} target="_blank" rel="noreferrer">
                Open in Figma
              </Menu.Item>
            </Menu>
          )
        }
        history={history}
        historyEmpty={historyEmpty}
      >
        {node.blocked && (
          <Text as="p" color="tertiary">
            Blocked{node.blocked.by ? ` by ${node.blocked.by}` : ''}
            {node.blocked.at ? ` ${timeAgo(node.blocked.at, now)}` : ''}
            {node.blocked.reason ? `: ${node.blocked.reason}` : ''}
          </Text>
        )}
        {canAct && blocking && !blocked && <BlockForm fileKey={fileKey} nodeId={nodeId} onDone={() => setBlocking(false)} />}
        {unblock.isError && <Text color="error-primary">{unblock.error.message}</Text>}
      </NodeDetails>
      <Drawer.Footer>
        <CopyPromptButton fileKey={fileKey} node={node} />
        {canAct &&
          (blocked ? (
            <Button hierarchy="secondary" size="sm" loading={unblock.isPending} onPress={() => unblock.mutate(nodeId)}>
              Unblock
            </Button>
          ) : (
            <Button hierarchy="secondary" size="sm" isDisabled={blocking} onPress={() => setBlocking(true)}>
              Block…
            </Button>
          ))}
        {node.figmaUrl && (
          <Button hierarchy="primary" size="sm" href={node.figmaUrl} target="_blank" rel="noreferrer">
            Open in Figma
          </Button>
        )}
      </Drawer.Footer>
    </>
  );
}

export interface NodeDrawerProps {
  fileKey: string;
  /** The open node; `null` closes the drawer. */
  nodeId: string | null;
  onClose: () => void;
  /** Overrides the session's role (agents see claim and block actions; viewers don't). */
  role?: SessionRole;
}

/**
 * Figma *Node drawer*: `Node Details` (status, claim, change list / history) with agent actions in the footer.
 * Each node opens on Change History in the narrow drawer; the Change List tab widens it.
 */
export function NodeDrawer({ fileKey, nodeId, onClose, role }: NodeDrawerProps) {
  const sessionRole = useSessionRole();
  const [view, setView] = useState<{ nodeId: string | null; tab: NodeDetailsState }>({ nodeId, tab: 'change-history' });
  const tab = view.nodeId === nodeId ? view.tab : 'change-history';
  return (
    <Drawer
      isOpen={!!nodeId}
      onOpenChange={open => !open && onClose()}
      aria-label="Node"
      size={tab === 'change-list' ? 'wide' : 'narrow'}
      className={tab === 'change-list' ? undefined : 'w-145.75'}
    >
      {nodeId && (
        <NodeDrawerContent
          key={nodeId}
          fileKey={fileKey}
          nodeId={nodeId}
          role={role ?? sessionRole}
          tab={tab}
          onTabChange={next => setView({ nodeId, tab: next })}
        />
      )}
    </Drawer>
  );
}
