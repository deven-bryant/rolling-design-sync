/** `Node Details - Claim Holder` (`198:80093`, Portal components page) → `<ClaimHolder>`; `Property 1` → `details` set or not. */
export const figmaClaimHolder = {
  component: { nodeId: '198:80093', name: 'Node Details - Claim Holder' },
  axes: {
    'Property 1': {
      Claimed: { nodeId: '198:79173', props: { details: '[Name, Claim Time, Lease Expiration]' } },
      Unclaimed: { nodeId: '198:80094', props: { details: undefined } },
    },
  },
  layers: {
    'Claim Holder': 'Text as h3 size lg semibold',
    'Frame / labels · values': 'dl grid: dt font-regular · dd font-semibold, text-sm text-tertiary, gap-x-md',
    'Buttons/Button': 'action (Button hierarchy="secondary" size="sm": Release claim / Add note)',
  },
} as const;
