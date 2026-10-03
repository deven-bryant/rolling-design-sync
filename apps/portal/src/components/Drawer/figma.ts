/**
 * Figma → code for the `Drawer/` folder (Portal file `PORTAL_DESIGN_FILE`).
 * The drawer frame itself is screen content (*Node tree — node detail* → `Node drawer`); its header is a component.
 */

/** `_Slide out menu header` (`22:1335`) → `<Drawer.Header>`. */
export const figmaDrawerHeader = {
  componentSet: { name: '_Slide out menu header' },
  axes: {
    Tabs: { prop: null, values: { False: {} } },
    Breakpoint: { prop: null, values: { Desktop: {} } },
  },
  properties: {
    'Icon#3293:0': 'icon',
    'Supporting text#3293:17': 'description',
  },
  variants: {
    'Tabs=False, Breakpoint=Desktop': {
      nodeId: '22:1335',
      key: 'd9f9d904db79d9eb7e3d6c11c6c58ee475177407',
      props: {},
    },
  },
} as const;

/**
 * Screen frame `Node drawer` (`22:1988`) and its `Overlay` (`22:1987`, `bg-overlay` at 70%) → `<Drawer>`.
 * The frame is 505px with 10px padding around `Node Details` (`50:15024`) on `State=Change History` → `size="narrow"`
 * (padding `spacing-lg`, the nearest token, used by the drawer's footer); for `State=Change List` (designed at 1080px)
 * it widens to `size="wide"` (1100px). A fixed 480px frame is `size="default"`.
 */
export const figmaDrawer = {
  frame: { nodeId: '22:1988', name: 'Node drawer' },
  sizes: {
    default: { width: 480, layoutSizingHorizontal: 'FIXED' },
    narrow: { width: 505, padding: 10, state: 'Change History' },
    wide: { width: 1100, padding: 10, state: 'Change List' },
  },
  overlay: { nodeId: '22:1987', name: 'Overlay' },
  parts: {
    Body: 'Drawer.Body',
    'Section / *': 'Drawer.Section',
    Footer: 'Drawer.Footer',
    'Node Details': 'NodeDetails (components/domain/NodeDetails)',
  },
} as const;
