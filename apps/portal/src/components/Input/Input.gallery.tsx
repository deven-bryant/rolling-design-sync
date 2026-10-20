import { Input as AriaInput, TextField } from 'react-aria-components';
import { PORTAL_DESIGN_FILE } from '../../figma-file';
import { inBothThemes, Icon, type GalleryEntry } from '../primitives';
import { HelpIcon } from './HelpIcon';
import { Input } from './Input';
import { inputFrameStyles, inputTextClass } from './InputParts';

export default {
  component: 'Input',
  examples: inBothThemes([
    {
      figma: 'Size=sm, Type=Default, Destructive=False, State=Placeholder',
      render: () => (
        <Input
          label="Email"
          required
          hint="This is a hint text to help user."
          tooltip="We only use this for claim notifications."
          iconLeading={<Icon name="mail-01" size="md" />}
          placeholder="olivia@untitledui.com"
          className="max-w-xs"
        />
      ),
    },
    {
      figma: 'Label=False, Hint text=False, Icon leading=False (aria-label)',
      render: () => <Input aria-label="Filter nodes" placeholder="Filter nodes" className="max-w-xs" />,
    },
    {
      figma: 'Filled',
      render: () => <Input label="Worker" defaultValue="devin-1" className="max-w-xs" />,
    },
    {
      figma: 'Disabled',
      render: () => <Input label="File key" defaultValue={PORTAL_DESIGN_FILE} isDisabled className="max-w-xs" />,
    },
    {
      figma: 'Input.Label · Input.Hint (custom layout)',
      render: () => (
        <TextField className="flex max-w-xs flex-col gap-sm">
          <Input.Label required>Label</Input.Label>
          <div className={inputFrameStyles({ className: 'focus-within:outline-2 focus-within:-outline-offset-1' })}>
            <AriaInput placeholder="Custom field" className={inputTextClass} />
          </div>
          <Input.Hint>Custom layouts compose the parts.</Input.Hint>
        </TextField>
      ),
    },
    { figma: 'Help icon: Open=False, Supporting text=False, Tooltip=Top no arrow', set: 'Help icon', variant: 'Open=False, Supporting text=False, Tooltip=Top no arrow', render: () => <HelpIcon label="Help" /> },
  ]),
} satisfies GalleryEntry;
