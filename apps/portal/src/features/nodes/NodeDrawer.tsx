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
import { RemovalPanel, type RemovalUse, type RemovalWarning } from '../../components/domain/RemovalPanel';
import { StateBadge } from '../../components/domain/StateBadge';
import { TokenValue } from '../../components/domain/TokenValue';
import { Input } from '../../components/Input';
import { Menu } from '../../components/Menu';
import { Text } from '../../components/primitives';
import { showToast } from '../../components/Toast';
import { Tooltip, TooltipTrigger } from '../../components/Tooltip';
import { categoriesOf, type Category } from './categories';
import {
  changeEntries,
  formatValue,
  isTokenNodeId,
  isTokenValue,
  nodePrompt,
  plural,
  removalPrompt,
  sideLabel,
  timeAgo,
  timeUntil,
  tokenCodeSyntax,
  tokenMeta,
  tokenValueView,
} from './format';
import { useBlockNode, useLibraryLinks, useNodeDetail, useNodeHistory, useReleaseClaim, useSessionRole, useUnblockNode } from './queries';
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

/** A token's `value:<Mode>` side: a swatch and the value, or a link to the aliased token. */
function modeValue(side: unknown, onOpenNode?: (nodeId: string) => void): NodeDetailsValue {
  const view = tokenValueView(side);
  if (view.alias) {
    const target = view.alias;
    return {
      value: onOpenNode ? (
        <Button hierarchy="link-color" size="sm" onPress={() => onOpenNode(target)} aria-label={`Open token ${view.aliasName ?? view.text}`}>
          {view.text}
        </Button>
      ) : (
        view.text
      ),
      detail: view.aliasName !== view.text ? view.aliasName : undefined,
    };
  }
  return { value: <TokenValue swatch={view.swatch}>{view.text}</TokenValue> };
}

function changeRows(node: NodeDetail, onOpenNode?: (nodeId: string) => void): NodeDetailsChange[] {
  const token = isTokenNodeId(node.nodeId);
  return changeEntries(node).map(([prop, change]) =>
    token && prop.startsWith('value:')
      ? { attribute: prop, from: modeValue(change.built, onOpenNode), to: modeValue(change.now, onOpenNode) }
      : { attribute: prop, from: changeValue(change.built), to: changeValue(change.now) },
  );
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
  token: 'brand',
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

function CopyTextButton({ text, label, hierarchy = 'tertiary' }: { text: () => string; label: string; hierarchy?: 'secondary' | 'tertiary' }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = setTimeout(() => setCopied('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    const write = navigator.clipboard?.writeText(text()) ?? Promise.reject(new Error('Clipboard unavailable'));
    write.then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    );
  };
  return (
    <Button hierarchy={hierarchy} size="sm" onPress={copy}>
      <span aria-live="polite">{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : label}</span>
    </Button>
  );
}

/** The *Copy component key* tooltip while the server has no Figma token. */
export const LIBRARY_LINKS_OFF = 'Library component. Set RDS_FIGMA_TOKEN on the server to open it in its library file.';

/** Stands in for *Open in Figma* on an unresolved library node: copies its component key, with a toast. */
function CopyKeyButton({ componentKey, libraryLinks }: { componentKey: string; libraryLinks: boolean | undefined }) {
  const copy = () => {
    const write = navigator.clipboard?.writeText(componentKey) ?? Promise.reject(new Error('Clipboard unavailable'));
    write.then(
      () => void showToast('Component key copied'),
      () => void showToast('Couldn’t copy the component key', { tone: 'error' }),
    );
  };
  const button = (
    <Button hierarchy="secondary" size="sm" onPress={copy}>
      Copy component key
    </Button>
  );
  if (libraryLinks !== false) return button;
  return (
    <TooltipTrigger>
      {button}
      <Tooltip>{LIBRARY_LINKS_OFF}</Tooltip>
    </TooltipTrigger>
  );
}

/** A removed work item's root opened in the drawer: what its *Removal* panel lists. */
export interface NodeRemoval {
  name?: string | null;
  uses?: readonly RemovalUse[];
  warnings?: readonly RemovalWarning[];
}

interface TabProps {
  tab: NodeDetailsState;
  onTabChange: (tab: NodeDetailsState) => void;
}

interface ContentProps extends TabProps {
  fileKey: string;
  nodeId: string;
  role: SessionRole;
  removal?: NodeRemoval;
  onOpenNode?: (nodeId: string) => void;
}

function NodeDrawerContent({ fileKey, nodeId, role, removal, onOpenNode, ...tab }: ContentProps) {
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
  return <LoadedNode fileKey={fileKey} nodeId={nodeId} node={node} role={role} removal={removal} onOpenNode={onOpenNode} {...tab} />;
}

function LoadedNode({
  fileKey,
  nodeId,
  node,
  role,
  removal,
  onOpenNode,
  tab,
  onTabChange,
}: ContentProps & { node: NodeDetail }) {
  const unblock = useUnblockNode(fileKey);
  const libraryLinks = useLibraryLinks();
  const now = useNow(30_000);
  const [blocking, setBlocking] = useState(false);
  const canAct = role === 'agent';
  const claim = useClaim({ fileKey, node, canAct, now });
  const { history, historyEmpty } = useHistory(fileKey, nodeId, now);

  const main = node.isInstance && node.mainComponentId ? ` → main ${node.mainComponentId}` : '';
  const categories = categoriesOf(node.changedProps ?? []);
  const blocked = node.state === 'blocked' || !!node.blocked;
  const name = node.name ?? nodeId;
  const componentKey = node.library?.key;
  const token = isTokenNodeId(node.nodeId ?? nodeId);
  const badge = token ? 'Token' : node.library ? 'Library' : null;
  const layers = node.usage?.layers;
  return (
    <>
      <NodeDetails
        className="min-h-0 flex-1 overflow-y-auto"
        state={tab}
        onStateChange={onTabChange}
        title={
          badge ? (
            <span className="flex flex-wrap items-center gap-md">
              {name}
              <Badge size="md" color="gray">
                {badge}
              </Badge>
            </span>
          ) : (
            name
          )
        }
        description={token ? tokenMeta(node) : `${node.type ?? 'NODE'} · ${node.nodeId ?? nodeId}${main}`}
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
        changes={node.changesKnown === false ? [] : changeRows(node, onOpenNode)}
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
        {layers !== undefined && (
          <Text as="p" color="tertiary">
            Used by {plural(layers, 'layer', 'layers')}
          </Text>
        )}
        {removal && (
          <RemovalPanel
            name={removal.name ?? name}
            uses={removal.uses ?? []}
            warnings={removal.warnings ?? []}
            action={
              <CopyTextButton
                hierarchy="secondary"
                label="Copy removal prompt"
                text={() =>
                  removalPrompt({ fileKey, nodeId: node.nodeId ?? nodeId, name: removal.name ?? node.name, uses: removal.uses, warnings: removal.warnings })
                }
              />
            }
          />
        )}
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
        <CopyTextButton label="Copy node prompt" text={() => nodePrompt({ fileKey, nodeId: node.nodeId ?? '', name: node.name, codeSyntax: tokenCodeSyntax(node) })} />
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
        {node.figmaUrl ? (
          <Button hierarchy="primary" size="sm" href={node.figmaUrl} target="_blank" rel="noreferrer">
            Open in Figma
          </Button>
        ) : (
          node.library && componentKey && <CopyKeyButton componentKey={componentKey} libraryLinks={libraryLinks} />
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
  /** The node is a removed work item's root: show its *Removal* panel above the change list. */
  removal?: NodeRemoval;
  /** Opens another node's drawer (a token's alias links to the token it points at). */
  onOpenNode?: (nodeId: string) => void;
}

/**
 * Figma *Node drawer*: `Node Details` (status, claim, change list / history) with agent actions in the footer.
 * Each node opens on Change History in the narrow drawer; the Change List tab widens it.
 */
export function NodeDrawer({ fileKey, nodeId, onClose, role, removal, onOpenNode }: NodeDrawerProps) {
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
          removal={removal}
          onOpenNode={onOpenNode}
          tab={tab}
          onTabChange={next => setView({ nodeId, tab: next })}
        />
      )}
    </Drawer>
  );
}
