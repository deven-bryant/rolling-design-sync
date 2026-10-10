// The portal's layer rule (docs/ui-portal.md "Layers"): imports only go down
// tokens → primitives → components → domain → features → routes, and nothing
// below features knows about the API or the query cache.
import path from 'node:path';

/** @typedef {'tokens' | 'primitives' | 'components' | 'domain' | 'features' | 'api' | 'theme' | 'routes' | 'test' | 'app'} Layer */

/** What each layer may import from inside `src/`. */
const allowed = {
  tokens: ['tokens'],
  primitives: ['tokens', 'primitives'],
  components: ['tokens', 'primitives', 'components'],
  domain: ['tokens', 'primitives', 'components', 'domain'],
  features: ['tokens', 'primitives', 'components', 'domain', 'features', 'api'],
  api: ['api'],
  theme: ['theme'],
  routes: ['tokens', 'primitives', 'components', 'domain', 'features', 'api', 'theme', 'routes'],
  test: ['test'],
  app: ['tokens', 'primitives', 'components', 'domain', 'features', 'api', 'theme', 'routes', 'app'],
};

/** Packages the presentational layers must not use: they get data and callbacks as props. */
const presentationalBans = ['@tanstack/react-query'];
const presentational = new Set(['primitives', 'components', 'domain']);

/**
 * @param {string} file absolute path
 * @param {string} src absolute path of `src/`
 * @returns {Layer | null}
 */
export function layerOf(file, src) {
  const rel = path.relative(src, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [top, second] = rel.split(path.sep);
  switch (top) {
    case 'styles':
    case 'figma-file.ts':
    case 'figma-file':
      return 'tokens';
    case 'components':
      if (second === 'primitives') return 'primitives';
      if (second === 'domain') return 'domain';
      return 'components';
    case 'features':
      return 'features';
    case 'api':
      return 'api';
    case 'theme':
      return 'theme';
    case 'routes':
      return 'routes';
    case 'test':
      return 'test';
    default:
      return 'app';
  }
}

const isTestFile = file => /\.test\.[jt]sx?$/.test(file);

/** @type {import('eslint').Rule.RuleModule} */
export const layersRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the portal layer order (docs/ui-portal.md "Layers").' },
    schema: [{ type: 'object', properties: { src: { type: 'string' } }, required: ['src'], additionalProperties: false }],
    messages: {
      upward: '{{from}} must not import from {{to}} ({{specifier}}). Imports only go down: {{allowed}}.',
      presentational: '{{from}} is presentational and must not import {{specifier}}; pass data and callbacks as props.',
    },
  },
  create(context) {
    const src = path.resolve(context.options[0].src);
    const file = context.filename;
    const from = layerOf(file, src);
    if (!from) return {};

    function check(node) {
      const specifier = node.source && node.source.value;
      if (typeof specifier !== 'string') return;
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        if (presentational.has(from) && presentationalBans.some(p => specifier === p || specifier.startsWith(`${p}/`))) {
          context.report({ node: node.source, messageId: 'presentational', data: { from, specifier } });
        }
        return;
      }
      const target = specifier.startsWith('/src/')
        ? path.join(src, specifier.slice('/src/'.length))
        : path.resolve(path.dirname(file), specifier);
      const to = layerOf(target, src);
      if (!to) return;
      if (to === 'test' && isTestFile(file)) return;
      if (allowed[from].includes(to)) return;
      context.report({
        node: node.source,
        messageId: 'upward',
        data: { from, to, specifier, allowed: allowed[from].join(', ') },
      });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default { rules: { layers: layersRule } };
