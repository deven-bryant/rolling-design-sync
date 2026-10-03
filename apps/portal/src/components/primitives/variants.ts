import { cx } from './cx';

type VariantMap = Record<string, Record<string, string>>;

type PropValue<Keys> = Keys extends 'true' | 'false' ? boolean : Keys;

/** The props a variant map accepts: each axis is optional; `true`/`false` keys become a boolean prop. */
export type VariantSelection<V extends VariantMap> = {
  [Axis in keyof V]?: PropValue<keyof V[Axis] & string>;
};

export interface VariantConfig<V extends VariantMap> {
  /** Classes every variant gets. */
  base?: string;
  variants: V;
  defaults?: VariantSelection<V>;
  /** Extra classes when every listed axis matches. */
  compound?: (VariantSelection<V> & { className: string })[];
}

export type VariantFn<V extends VariantMap> = ((props?: VariantSelection<V> & { className?: string | undefined }) => string) & {
  readonly variants: V;
};

/** The selection props of a `variants()` result, for a component's prop type. */
export type VariantProps<F> = F extends VariantFn<infer V> ? VariantSelection<V> : never;

const key = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : String(value));

/**
 * A typed map from props to classes, so every component declares variants the same way.
 *
 *   const button = variants({ base: 'inline-flex', variants: { size: { sm: 'px-md', md: 'px-lg' } }, defaults: { size: 'md' } });
 *   button({ size: 'sm', className: 'w-full' }) // → 'inline-flex px-md w-full'
 */
export function variants<V extends VariantMap>(config: VariantConfig<V>): VariantFn<V> {
  const fn = (props: VariantSelection<V> & { className?: string | undefined } = {}): string => {
    const selected: Record<string, string | undefined> = {};
    for (const axis of Object.keys(config.variants)) {
      selected[axis] = key(props[axis]) ?? key(config.defaults?.[axis]);
    }
    const classes = Object.entries(config.variants).map(([axis, options]) => {
      const choice = selected[axis];
      return choice === undefined ? undefined : options[choice];
    });
    const compound = (config.compound ?? [])
      .filter(({ className: _className, ...when }) =>
        Object.entries(when).every(([axis, value]) => selected[axis] === key(value)),
      )
      .map(c => c.className);
    return cx(config.base, ...classes, ...compound, props.className);
  };
  return Object.assign(fn, { variants: config.variants });
}
