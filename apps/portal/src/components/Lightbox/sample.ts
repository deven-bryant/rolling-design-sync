/** A small inline SVG standing in for a screenshot in galleries and tests. */
export const sampleImage = (label = 'Screen', fill = '#e7eaec') =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${fill}"/><rect x="16" y="16" width="288" height="24" rx="4" fill="#d3d8da"/><text x="160" y="120" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#52595d">${label}</text></svg>`,
  )}`;
