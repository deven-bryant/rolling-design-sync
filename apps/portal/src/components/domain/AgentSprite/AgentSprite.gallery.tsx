import { useState } from 'react';
import { Button } from '../../Button';
import type { GalleryEntry, GalleryExample } from '../../primitives';
import { AgentSprite, type AgentSpriteState } from '.';

const next: Record<AgentSpriteState, AgentSpriteState> = { enter: 'idle', idle: 'poof', poof: 'enter', fade: 'enter' };

function Lifecycle() {
  const [state, setState] = useState<AgentSpriteState>('enter');
  return (
    <span className="flex items-center gap-lg">
      <AgentSprite worker="devin-7f3a" state={state} onAnimationEnd={done => setState(next[done])} />
      <Button size="sm" hierarchy="secondary" onPress={() => setState(state === 'idle' ? 'poof' : 'fade')}>
        {state === 'idle' ? 'Clear (poof)' : 'Expire (fade)'}
      </Button>
    </span>
  );
}


const themes = [
  ['Light', undefined],
  ['Dark', 'dark'],
] as const;

/** Each example once per theme: `Color Mode` is the `data-theme` it renders under, never a prop. */
const bothThemes = (examples: { figma: string; render: (mode: string) => ReturnType<GalleryExample['render']> }[]) =>
  themes.flatMap(([mode, theme]) =>
    examples.map(({ figma, render }): GalleryExample => ({
      figma: `${figma} · Color Mode=${mode}`,
      render: () => (
        <div data-theme={theme} className="bg-primary">
          {render(mode)}
        </div>
      ),
    })),
  );

export default {
  component: 'AgentSprite',
  examples: bothThemes([
    {
      figma: 'Agent cell · Avatar (Size=sm), colored per worker',
      render: () => (
        <span className="flex items-center gap-lg">
          {['claude-local', 'devin-7f3a', 'devin-a1b2', 'control', 'portal:viewer'].map(worker => (
            <AgentSprite key={worker} worker={worker} />
          ))}
        </span>
      ),
    },
    { figma: 'States: enter → idle → poof / fade', render: () => <Lifecycle /> },
  ]),
} satisfies GalleryEntry;
