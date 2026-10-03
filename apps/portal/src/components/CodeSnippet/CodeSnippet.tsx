import { Copy } from 'lucide-react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { ButtonUtility } from '../Button';
import { variants, type VariantProps } from '../primitives';

export const codeSnippetStyles = variants({
  base: 'relative flex flex-col overflow-hidden rounded-xl border border-secondary bg-primary',
  variants: { type: { simple: '' } },
  defaults: { type: 'simple' },
});

export interface CodeSnippetProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof codeSnippetStyles> {
  /** The code, shown as is (no highlighting). */
  code: string;
  /** Tabs slot above the code. */
  tabs?: ReactNode;
  /** Show the line-number sidebar. */
  lineNumbers?: boolean;
  /** Accessible name of the copy button; without it there is no copy button. */
  copyLabel?: string;
  /** Called after the code was copied to the clipboard. */
  onCopy?: () => void;
  ref?: Ref<HTMLDivElement>;
}

/** `Code snippet` (`Type=Simple`): line numbers, monospace code and a copy button. */
export function CodeSnippet({
  type,
  code,
  tabs,
  lineNumbers = true,
  copyLabel,
  onCopy,
  className,
  ref,
  ...rest
}: CodeSnippetProps) {
  const lines = code.split('\n');
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    onCopy?.();
  };
  return (
    <div ref={ref} className={codeSnippetStyles({ type, className })} {...rest}>
      {tabs}
      <div className="flex">
        {lineNumbers && (
          <div
            aria-hidden
            className="shrink-0 border-r border-secondary bg-secondary px-xl py-2xl text-right font-mono text-sm font-bold text-quaternary"
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre className="min-w-0 flex-1 overflow-x-auto p-2xl font-mono text-sm text-primary">
          <code>{code}</code>
        </pre>
      </div>
      {copyLabel != null && (
        <ButtonUtility
          hierarchy="tertiary"
          tooltip={copyLabel}
          icon={<Copy strokeWidth={2} />}
          onPress={() => void copy()}
          className="absolute top-lg right-lg"
        />
      )}
    </div>
  );
}
