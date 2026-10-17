/** The API's change categories, in its rule order (`packages/core` CATEGORY_RULES, then `other`), `note` for open notes and `render` for render-check mismatches. */
export const CATEGORIES = [
  'layout',
  'color',
  'typography',
  'effects',
  'component',
  'content',
  'structure',
  'prototype',
  'token',
  'other',
  'note',
  'render',
] as const;

export type Category = (typeof CATEGORIES)[number];

const RULES: Record<Exclude<Category, 'other' | 'note' | 'render'>, readonly string[]> = {
  layout: [
    'width', 'height', 'x', 'y', 'rotation', 'layoutMode', 'layoutWrap', 'layoutPositioning', 'layoutAlign', 'layoutGrow',
    'layoutSizingHorizontal', 'layoutSizingVertical', 'primaryAxis*', 'counterAxis*', 'itemSpacing', 'counterAxisSpacing', 'padding*',
    'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'constraints', 'clipsContent', 'grid*', 'layoutGrids', 'gridStyleId',
    'strokesIncludedInLayout', 'itemReverseZIndex',
  ],
  color: ['fills', 'strokes', 'fillStyleId', 'strokeStyleId', 'opacity', 'blendMode', 'stroke*', 'dashPattern'],
  typography: [
    'fontName', 'fontSize', 'fontWeight', 'textCase', 'textDecoration*', 'letterSpacing', 'lineHeight', 'textAlign*',
    'textAutoResize', 'paragraph*', 'list*', 'hanging*', 'textTruncation', 'maxLines', 'textStyleId', 'openTypeFeatures', 'leadingTrim',
    'textWrapStyle', 'indentation', 'textSegments',
  ],
  effects: ['effects', 'effectStyleId', 'cornerRadius', '*Radius', 'cornerSmoothing', 'isMask', 'visible'],
  component: [
    'componentProperties', 'componentPropertyReferences', 'componentPropertyDefinitions', 'variantProperties',
    'mainComponentId', 'isInstance', 'overrides',
  ],
  content: ['characters', 'hyperlink', 'vectorPaths', 'vectorNetwork', 'booleanOperation', 'arcData', 'pointCount', 'innerRadius', 'description'],
  structure: ['parentId', 'childIds', 'children', 'name'],
  prototype: ['reactions', 'overflowDirection', 'numberOfFixedChildren', 'overlay*'],
  token: ['value:*'],
};

const ruleCategories = Object.keys(RULES) as Exclude<Category, 'other' | 'note' | 'render'>[];

/** A property's change category, as the API assigns it: exact names first, then patterns in rule order. */
export function categoryOf(prop: string): Category {
  const exact = ruleCategories.find(c => RULES[c].includes(prop));
  if (exact) return exact;
  const match = ruleCategories.find(c =>
    RULES[c].some(rule =>
      rule.endsWith('*') ? prop.startsWith(rule.slice(0, -1)) : rule.startsWith('*') ? prop.endsWith(rule.slice(1)) : false,
    ),
  );
  return match ?? 'other';
}

/** The distinct categories of some changed properties, in the API's order. */
export function categoriesOf(props: readonly string[]): Category[] {
  const found = new Set(props.map(categoryOf));
  return CATEGORIES.filter(c => found.has(c));
}
