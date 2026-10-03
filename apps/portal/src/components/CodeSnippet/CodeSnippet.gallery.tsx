import type { GalleryEntry } from '../primitives';
import { CodeSnippet } from './CodeSnippet';

const code = `// Imports
import mongoose, { Schema } from 'untitled'

// Collection name
export const collection = 'Design'

// Schema
const schema = new Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  }
}, {timestamps: true})

// Model
export default untitled.model(collection, schema, collection)`;

export default {
  component: 'CodeSnippet',
  examples: [
    { figma: 'Type=Simple', render: () => <CodeSnippet code={code} copyLabel="Copy code" /> },
    { figma: 'Type=Simple, tabs slot', render: () => <CodeSnippet code="npm ci" tabs={<div className="border-b border-secondary px-2xl py-lg text-sm font-semibold text-secondary">Shell</div>} /> },
  ],
} satisfies GalleryEntry;
