import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChartPie,
  ChevronsUpDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CopyCheck,
  EllipsisVertical,
  House,
  type LucideIcon,
  Mail,
  Moon,
  Rows2,
  Search,
  Settings,
  SquareKanban,
  Sun,
  Users,
  X,
} from 'lucide-react';

export interface FigmaIcon {
  /** The icon set's component that draws it. */
  component: LucideIcon;
  /** The Figma main component (Portal file, Section 1, revision 3); null for icons the design file doesn't have. */
  nodeId: string | null;
  /** The Figma component key; null for icons the design file doesn't have. */
  key: string | null;
  /** Classes that adapt the icon set's glyph to the Figma drawing. */
  className?: string;
}

/** Every icon in the design file, by its Figma component name. */
export const figmaIcons = {
  'alert-circle': { component: CircleAlert, nodeId: null, key: null },
  'arrow-left': { component: ArrowLeft, nodeId: '90:8962', key: '650f4c2f034d0f8b88d444003b4c13593b84dc9e' },
  'arrow-right': { component: ArrowRight, nodeId: '90:8970', key: '9cde613e50d96ee88077ff2c579619ed32af71fa' },
  'arrow-up-right': { component: ArrowUpRight, nodeId: '92:24845', key: 'f13bc12ee71870f70f9b2cec6432adc9f8bc9bab' },
  'bar-chart-square-02': {
    component: SquareKanban,
    nodeId: '92:22330',
    key: 'e948232d17cb46f3b5deeef6eb8842dcd659622e',
    className: '-scale-y-100',
  },
  'check-done-01': { component: CopyCheck, nodeId: '92:17346', key: '30ffe73a1cf3b443c6ab453d0c9a7529d79b0441' },
  'check-circle': { component: CircleCheck, nodeId: '92:22955', key: 'a5afeebd6db1a78df56af3bef6fafe75a367b7bd' },
  'chevron-down': { component: ChevronDown, nodeId: '92:10769', key: '6444d0bc968f40ec11020a42feb04479b11449b7' },
  'chevron-right': { component: ChevronRight, nodeId: '92:10657', key: '33ba7af76ad66927f477e0cade1526b7b06219da' },
  'chevron-selector-vertical': {
    component: ChevronsUpDown,
    nodeId: '92:22447',
    key: 'd6a8ef5eb3892344c812d929513a122beaf8c40e',
  },
  'dots-vertical': { component: EllipsisVertical, nodeId: '92:16647', key: '13b5c01a82a3088176e9e167b3342d03f648c2be' },
  'help-circle': { component: CircleHelp, nodeId: '92:12336', key: 'cc4213aab3a0755fe9ff7815fa390d5e4cf10e58' },
  'home-line': { component: House, nodeId: '92:10719', key: 'e512479acdc24d66c1282e729f20775afbebc04b' },
  'mail-01': { component: Mail, nodeId: '92:17838', key: 'ce3cd2758a41935b5de6f2d988de727fd1995088' },
  'moon-01': { component: Moon, nodeId: '121:41366', key: 'e796275a37c7b8cf745e4303bf3d0c6ac0560639' },
  'pie-chart-03': { component: ChartPie, nodeId: '92:22402', key: 'cd989144fe8164dfe2aef1bcfd7ba0d20658bb26' },
  placeholder: { component: Circle, nodeId: '90:8859', key: '2a70a20746e7417e58420f790c4dfad9f2cea3e7' },
  'rows-01': { component: Rows2, nodeId: '92:10659', key: '53ee5aed82280971f9ce3f436937444a2adf4aa8' },
  'search-lg': { component: Search, nodeId: '92:12877', key: 'd39ae03289e2aafb53d968c58a47b601ba0377f4' },
  'settings-01': { component: Settings, nodeId: null, key: null },
  sun: { component: Sun, nodeId: '121:41382', key: 'c983c55630ca893381d73f470ba81f42ee462aa8' },
  'users-01': { component: Users, nodeId: '92:10690', key: '97ca2ee36bcb4cf58f4b357f369b045b02e71eff' },
  'x-close': { component: X, nodeId: '92:12932', key: '92bd92978c27878daa77962cabf85a96f14bc67b' },
} as const satisfies Record<string, FigmaIcon>;

export type IconName = keyof typeof figmaIcons;

export const iconNames = Object.keys(figmaIcons) as IconName[];
