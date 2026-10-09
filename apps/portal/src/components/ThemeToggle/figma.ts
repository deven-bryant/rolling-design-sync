/**
 * Figma ↔ code for ThemeToggle (Portal file `PORTAL_DESIGN_FILE`, Section 1): the sidebar header's
 * `Color Mode Toggle`. `State` is the theme in effect; the switch is a `Toggle` (`Size=md`).
 */
export const figmaThemeToggle = {
  component: 'ThemeToggle',
  setId: '121:41375',
  properties: { State: 'theme' },
  variants: [
    {
      nodeId: '121:41374',
      key: 'f658a3a6251b5c8c4f0661c2d4576c4e73132f3f',
      name: 'State=Light',
      code: '<ThemeToggle theme="light" onChange={setTheme} />',
    },
    {
      nodeId: '121:41376',
      key: 'b0ca9885e59ae34db0fe56d4adbfd2bdbcd82554',
      name: 'State=Dark',
      code: '<ThemeToggle theme="dark" onChange={setTheme} />',
    },
  ],
} as const;
