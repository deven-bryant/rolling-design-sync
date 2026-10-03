declare module 'jest-axe' {
  interface AxeViolation {
    id: string;
    impact?: string | null;
    help: string;
    nodes: { html: string }[];
  }
  interface AxeResults {
    violations: AxeViolation[];
  }
  export function axe(html: Element | string, options?: Record<string, unknown>): Promise<AxeResults>;
}
