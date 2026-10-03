import { createContext, useContext, type ReactNode, type Ref } from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from 'react-aria-components';
import { cx, variants, type VariantProps } from '../primitives';

export const tabListStyles = variants({
  base: 'flex',
  variants: {
    type: { underline: 'gap-lg border-b border-secondary', 'button-gray': 'gap-xs' },
  },
  defaults: { type: 'underline' },
});

export const tabStyles = variants({
  base: 'flex h-9 cursor-pointer items-center justify-center gap-md whitespace-nowrap font-semibold text-quaternary outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus-ring',
  variants: {
    type: {
      underline:
        '-mb-px border-b-2 border-transparent px-xs pb-lg data-hovered:text-brand-secondary data-selected:border-fg-brand-primary_alt data-selected:text-brand-secondary',
      'button-gray': 'rounded-sm px-lg py-md data-hovered:text-secondary data-selected:bg-active data-selected:text-secondary',
    },
    size: { sm: 'text-sm', md: 'text-md' },
  },
  defaults: { type: 'underline', size: 'md' },
  compound: [{ type: 'button-gray', size: 'md', className: 'h-11' }],
});

type TabStyle = Required<VariantProps<typeof tabStyles>>;

const TabStyleContext = createContext<TabStyle>({ type: 'underline', size: 'md' });

export interface TabsProps extends Omit<AriaTabsProps, 'className'>, VariantProps<typeof tabStyles> {
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Figma `Horizontal tabs` (Type=Underline · Button gray): React Aria tabs. Selection is controlled with
 * `selectedKey` + `onSelectionChange` (e.g. from the URL) or uncontrolled with `defaultSelectedKey`.
 */
export function Tabs({ type = 'underline', size = 'md', className, ...rest }: TabsProps) {
  return (
    <TabStyleContext.Provider value={{ type, size }}>
      <AriaTabs {...rest} className={cx('flex flex-col', className)} />
    </TabStyleContext.Provider>
  );
}

export interface TabsListProps<T> extends Omit<AriaTabListProps<T>, 'className'> {
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

function TabsList<T extends object>({ className, ...rest }: TabsListProps<T>) {
  const { type } = useContext(TabStyleContext);
  return <AriaTabList {...rest} className={tabListStyles({ type, className })} />;
}

export interface TabsTabProps extends Omit<AriaTabProps, 'className' | 'children'> {
  children: ReactNode;
  /** Figma `Badge`: a count badge after the label. */
  badge?: ReactNode;
  className?: string;
}

function TabsTab({ children, badge, className, ...rest }: TabsTabProps) {
  const style = useContext(TabStyleContext);
  return (
    <AriaTab {...rest} className={tabStyles({ ...style, className })}>
      {children}
      {badge}
    </AriaTab>
  );
}

export interface TabsPanelProps extends Omit<AriaTabPanelProps, 'className'> {
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

function TabsPanel({ className, ...rest }: TabsPanelProps) {
  return (
    <AriaTabPanel
      {...rest}
      className={cx('outline-none data-focus-visible:ring-2 data-focus-visible:ring-focus-ring', className)}
    />
  );
}

Tabs.List = TabsList;
Tabs.Tab = TabsTab;
Tabs.Panel = TabsPanel;
