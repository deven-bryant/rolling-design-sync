import { useEffect, useState } from 'react';
import { Button, type ButtonAsButtonProps } from '../components/Button';

const COPIED_MS = 2000;

/** A button that copies `text` and says so for a moment. */
export function CopyButton({ text, children, ...rest }: Omit<ButtonAsButtonProps, 'onPress'> & { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <Button {...rest} onPress={copy}>
      {copied ? 'Copied' : children}
    </Button>
  );
}
