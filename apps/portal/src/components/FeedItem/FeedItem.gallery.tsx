import { inBothThemes, type GalleryEntry } from '../primitives';
import { Avatar } from '../Avatar';
import { Feed, FeedItem, FileTypeIcon, type FeedDivider } from './FeedItem';

const avatar = <Avatar size="lg" alt="Olivia Rhye" initials="OR" status="online" />;
const message = '“Lorem ipsum dolor sit amet, consectetur adipiscing elit. Tincidunt nunc ipsum tempor purus vitae id.”';

function Example({ divider }: { divider: FeedDivider }) {
  return (
    <Feed divider={divider} className="w-90">
      <FeedItem
        avatar={avatar}
        name="Olivia Rhye"
        time="2 mins ago"
        unread
        supportingItem={<FeedItem.File name="Tech requirements.pdf" size="720 KB" />}
      >
        Added a file to <FeedItem.Highlight>Marketing site redesign</FeedItem.Highlight>
      </FeedItem>
      <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago" supportingItem={<FeedItem.Message>{message}</FeedItem.Message>}>
        Commented in <FeedItem.Highlight>Marketing site redesign</FeedItem.Highlight>
      </FeedItem>
      <FeedItem avatar={avatar} name="Olivia Rhye" time="2 mins ago" unread>
        Invited <FeedItem.Highlight>Lana Steiner</FeedItem.Highlight> to the team
      </FeedItem>
    </Feed>
  );
}

export default {
  component: 'FeedItem',
  figma: 'Activity feed',
  examples: inBothThemes([
    { figma: 'Activity feed: Divider=Connector (Supporting item=File · Text · False, Connector=True · last False)', set: 'Activity feed', variant: 'Divider=Connector (Supporting item=File · Text · False, Connector=True · last False)', render: () => <Example divider="connector" /> },
    { figma: 'Activity feed: Divider=False (Connector=False)', set: 'Activity feed', variant: 'Divider=False (Connector=False)', render: () => <Example divider="none" /> },
    { figma: 'File type icon: File type=Document / PDF, Type=Default', set: 'File type icon', variant: 'File type=Document / PDF, Type=Default', render: () => <FileTypeIcon type="pdf" /> },
  ]),
} satisfies GalleryEntry;
