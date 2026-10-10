import path from 'node:path';
import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import { layerOf, layersRule } from './layers.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const src = path.resolve('/repo/apps/portal/src');
const at = rel => path.join(src, rel);
const options = [{ src }];
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });

describe('layerOf', () => {
  it.each([
    ['styles/tokens.css', 'tokens'],
    ['components/primitives/Icon/Icon.tsx', 'primitives'],
    ['components/Button/Button.tsx', 'components'],
    ['components/domain/NodeCell/NodeCell.tsx', 'domain'],
    ['features/nodes/NodeTable.tsx', 'features'],
    ['api/client.ts', 'api'],
    ['theme/ThemeProvider.tsx', 'theme'],
    ['routes/router.tsx', 'routes'],
    ['test/axe.ts', 'test'],
    ['figma-file.ts', 'tokens'],
    ['main.tsx', 'app'],
  ])('%s → %s', (rel, layer) => {
    if (layerOf(at(rel), src) !== layer) throw new Error(`expected ${layer}`);
  });

  it('ignores files outside src', () => {
    if (layerOf('/repo/apps/portal/vite.config.ts', src) !== null) throw new Error('expected null');
  });
});

tester.run('portal/layers', layersRule, {
  valid: [
    { filename: at('components/primitives/Text/Text.tsx'), code: "import { variants } from '../variants';", options },
    { filename: at('components/primitives/Text/Text.tsx'), code: "import 'react';", options },
    { filename: at('components/Button/Button.tsx'), code: "import { Icon } from '../primitives';", options },
    { filename: at('components/Button/Button.tsx'), code: "import { PORTAL_DESIGN_FILE } from '../../figma-file';", options },
    { filename: at('components/Badge/Badge.tsx'), code: "import { Button } from '../Button';", options },
    { filename: at('components/domain/NodeCell/NodeCell.tsx'), code: "import { Badge } from '../../Badge';", options },
    { filename: at('features/nodes/NodeTable.tsx'), code: "import { api } from '../../api/client';", options },
    { filename: at('features/nodes/NodeTable.tsx'), code: "import { useQuery } from '@tanstack/react-query';", options },
    { filename: at('routes/Layout.tsx'), code: "import { NodeTable } from '../features/nodes/NodeTable';", options },
    { filename: at('main.tsx'), code: "import { router } from './routes/router';", options },
    { filename: at('components/primitives/Icon/Icon.test.tsx'), code: "import { expectNoAxeViolations } from '../../../test/axe';", options },
    { filename: at('routes/GalleryPage.tsx'), code: "const m = import('/src/components/primitives/Icon/Icon.gallery.tsx');", options },
  ],
  invalid: [
    {
      filename: at('components/primitives/Icon/Icon.tsx'),
      code: "import { Button } from '../../Button';",
      options,
      errors: [{ messageId: 'upward', data: { from: 'primitives', to: 'components', specifier: '../../Button', allowed: 'tokens, primitives' } }],
    },
    { filename: at('components/Button/Button.tsx'), code: "import { api } from '../../api/client';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('components/Button/Button.tsx'), code: "import { NodeCell } from '../domain/NodeCell';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('components/domain/NodeCell/NodeCell.tsx'), code: "import { useNodes } from '../../../features/nodes';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('features/nodes/NodeTable.tsx'), code: "import { Layout } from '../../routes/Layout';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('api/client.ts'), code: "import { Text } from '../components/primitives';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('components/Button/Button.tsx'), code: "export * from '../../routes/pages';", options, errors: [{ messageId: 'upward' }] },
    { filename: at('components/Button/Button.tsx'), code: "const p = import('../../features/x');", options, errors: [{ messageId: 'upward' }] },
    { filename: at('components/Button/Button.tsx'), code: "import { axe } from '../../test/axe';", options, errors: [{ messageId: 'upward' }] },
    {
      filename: at('components/primitives/Text/Text.tsx'),
      code: "import { useQuery } from '@tanstack/react-query';",
      options,
      errors: [{ messageId: 'presentational' }],
    },
    {
      filename: at('components/domain/NodeCell/NodeCell.tsx'),
      code: "import { useQueryClient } from '@tanstack/react-query';",
      options,
      errors: [{ messageId: 'presentational' }],
    },
  ],
});
