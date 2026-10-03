import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CircleHelp,
  EllipsisVertical,
  House,
  type LucideIcon,
  Mail,
  Search,
  SquareKanban,
  X,
} from 'lucide-react';

export interface FigmaIcon {
  /** The icon set's component that draws it. */
  component: LucideIcon;
  /** The Figma main component (Portal file, Section 1). */
  nodeId: string;
  /** The Figma component key. */
  key: string;
  /** Classes that adapt the icon set's glyph to the Figma drawing. */
  className?: string;
}

/** Every icon in the design file, by its Figma component name. */
export const figmaIcons = {
  'arrow-left': { component: ArrowLeft, nodeId: '9:2206', key: '777b9b4d7753a2035b6663fffb16c2c54fac5fb0' },
  'arrow-right': { component: ArrowRight, nodeId: '9:2818', key: '729bfc25812fac9fbcdb4bdca0d4edf2e2d3a823' },
  'arrow-up-right': { component: ArrowUpRight, nodeId: '24:1739', key: 'a707cbcb042a1aeb2536609275e683a282e5c399' },
  'bar-chart-square-02': {
    component: SquareKanban,
    nodeId: '9:7056',
    key: '48ab6b6297de0d38d50738148701d35625507dc9',
    className: '-scale-y-100',
  },
  'check-circle': { component: CircleCheck, nodeId: '9:8033', key: 'ac62425509ae8db853c3743d10cb7cdf8f3d5381' },
  'chevron-down': { component: ChevronDown, nodeId: '9:307', key: '3e85e58688d39ca4fc7712b70fa6270adaae33a1' },
  'chevron-right': { component: ChevronRight, nodeId: '9:6200', key: '0843d31d8fea1d274e2b9c867974dd4f3f9fe66e' },
  'chevron-selector-vertical': {
    component: ChevronsUpDown,
    nodeId: '9:7180',
    key: '5f270452ec1c189bdbff7447dda0f35187ca2a5c',
  },
  'dots-vertical': { component: EllipsisVertical, nodeId: '9:5505', key: 'c2940f5ecaac53d31b5858a074f5ed0eb6f2c8c2' },
  'help-circle': { component: CircleHelp, nodeId: '9:29', key: '6e6a5d1a7b921d16961c844d3bb2de6cb6ea97d4' },
  'home-line': { component: House, nodeId: '9:6005', key: '157f069e8b247dab47e3050474165fb04b5f9928' },
  'mail-01': { component: Mail, nodeId: '9:8355', key: 'ec8c81e8922d96f12ebbc36274552866bf0cdeb3' },
  placeholder: { component: Circle, nodeId: '9:2208', key: 'b6c7f6f6171a8a6fc66cdcc312215f3f47d89892' },
  'search-lg': { component: Search, nodeId: '9:859', key: '65f92c2ffa2b27db5648c61fe40ed45a473fc353' },
  'x-close': { component: X, nodeId: '9:921', key: '149c71c35bebdf2bbc48a332f35342ed578826c6' },
} as const satisfies Record<string, FigmaIcon>;

export type IconName = keyof typeof figmaIcons;

export const iconNames = Object.keys(figmaIcons) as IconName[];
