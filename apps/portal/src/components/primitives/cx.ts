import { extendTailwindMerge } from 'tailwind-merge';

const spacing = ['none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl', '10xl', '11xl'];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing,
      radius: ['none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full'],
      text: ['md', 'display-xs', 'display-sm', 'display-md', 'display-lg', 'display-xl', 'display-2xl'],
      'font-weight': ['regular'],
    },
  },
});

type ClassValue = string | false | null | undefined;

/** Joins class names; later Tailwind classes win over conflicting earlier ones (`cx('p-md', 'p-xl')` → `p-xl`). */
export function cx(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
