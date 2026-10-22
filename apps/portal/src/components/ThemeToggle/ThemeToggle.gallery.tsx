import { useState } from 'react';
import { inBothThemes, type GalleryEntry } from '../primitives';
import { ThemeToggle, type ThemeToggleTheme } from './ThemeToggle';

function Example({ initial }: { initial: ThemeToggleTheme }) {
  const [theme, setTheme] = useState(initial);
  return <ThemeToggle theme={theme} onChange={setTheme} />;
}

export default {
  component: 'ThemeToggle',
  figma: 'Color Mode Toggle',
  examples: inBothThemes([
    { figma: 'State=Light', render: () => <Example initial="light" /> },
    { figma: 'State=Dark', render: () => <Example initial="dark" /> },
  ]),
} satisfies GalleryEntry;
