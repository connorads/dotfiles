# Field Types Reference

## Core Field Types

### Text Fields

```ts
// Basic text
{ name: 'title', type: 'text', required: true }

// With validation
{
  name: 'email',
  type: 'text',
  validate: (value) => {
    if (!value?.includes('@')) return 'Invalid email'
    return true
  },
}

// With admin config
{
  name: 'description',
  type: 'textarea',
  admin: {
    placeholder: 'Enter description...',
    description: 'Brief summary',
  },
}
```

### Slug Field Helper

Auto-generate URL-safe slugs:

```ts
import { slugField } from '@payloadcms/plugin-seo'

// Or manual implementation
{
  name: 'slug',
  type: 'text',
  unique: true,
  index: true,
  hooks: {
    beforeValidate: [
      ({ data, operation, originalDoc }) => {
        if (operation === 'create' || !originalDoc?.slug) {
          return data?.title?.toLowerCase().replace(/\s+/g, '-')
        }
        return originalDoc.slug
      },
    ],
  },
}
```

### Number Fields

```ts
{ name: 'price', type: 'number', min: 0, required: true }
{ name: 'quantity', type: 'number', defaultValue: 1 }
```

### Select Fields

```ts
// Simple select
{
  name: 'status',
  type: 'select',
  options: ['draft', 'published', 'archived'],
  defaultValue: 'draft',
}

// With labels
{
  name: 'priority',
  type: 'select',
  options: [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
  ],
}

// Multi-select
{
  name: 'categories',
  type: 'select',
  hasMany: true,
  options: ['tech', 'design', 'marketing'],
}
```

### Checkbox

```ts
{ name: 'featured', type: 'checkbox', defaultValue: false }
```

### Date Fields

```ts
{ name: 'publishedAt', type: 'date' }

// With time
{
  name: 'eventDate',
  type: 'date',
  admin: { date: { pickerAppearance: 'dayAndTime' } },
}
```

## Relationship Fields

### Basic Relationship

```ts
// Single relationship
{
  name: 'author',
  type: 'relationship',
  relationTo: 'users',
  required: true,
}

// Multiple relationships (hasMany)
{
  name: 'tags',
  type: 'relationship',
  relationTo: 'tags',
  hasMany: true,
}

// Polymorphic (multiple collections)
{
  name: 'parent',
  type: 'relationship',
  relationTo: ['pages', 'posts'],
}
```

### With Filter Options

Dynamically filter available options:

```ts
{
  name: 'relatedPosts',
  type: 'relationship',
  relationTo: 'posts',
  hasMany: true,
  filterOptions: ({ data }) => ({
    // Only show published posts, exclude self
    status: { equals: 'published' },
    id: { not_equals: data?.id },
  }),
}
```

### Join Fields

Reverse relationship lookup (virtual field):

```ts
// In Posts collection
{
  name: 'comments',
  type: 'join',
  collection: 'comments',
  on: 'post', // field name in comments that references posts
}
```

## Virtual Fields

Computed fields that don't store data:

```ts
{
  name: 'fullName',
  type: 'text',
  virtual: true,
  hooks: {
    afterRead: [
      ({ data }) => `${data?.firstName} ${data?.lastName}`,
    ],
  },
}
```

## Conditional Fields

Show/hide fields based on other values:

```ts
{
  name: 'isExternal',
  type: 'checkbox',
},
{
  name: 'externalUrl',
  type: 'text',
  admin: {
    condition: (data) => data?.isExternal === true,
  },
}
```

## Validation

### Custom Validation

```ts
{
  name: 'slug',
  type: 'text',
  validate: (value, { data, operation }) => {
    if (!value) return 'Slug is required'
    if (!/^[a-z0-9-]+$/.test(value)) {
      return 'Slug must be lowercase letters, numbers, and hyphens only'
    }
    return true
  },
}
```

### Async Validation

```ts
{
  name: 'username',
  type: 'text',
  validate: async (value, { payload }) => {
    if (!value) return true
    const existing = await payload.find({
      collection: 'users',
      where: { username: { equals: value } },
    })
    if (existing.docs.length > 0) return 'Username already taken'
    return true
  },
}
```

## Group Fields

Organize related fields:

```ts
{
  name: 'meta',
  type: 'group',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'description', type: 'textarea' },
  ],
}
```

## Array Fields

Repeatable sets of fields:

```ts
{
  name: 'socialLinks',
  type: 'array',
  fields: [
    { name: 'platform', type: 'select', options: ['twitter', 'linkedin', 'github'] },
    { name: 'url', type: 'text' },
  ],
}
```

## Blocks (Polymorphic Content)

Different content types in same array:

```ts
{
  name: 'layout',
  type: 'blocks',
  blocks: [
    {
      slug: 'hero',
      fields: [
        { name: 'heading', type: 'text' },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
    {
      slug: 'content',
      fields: [
        { name: 'richText', type: 'richText' },
      ],
    },
  ],
}
```

## Point (Geolocation)

```ts
{
  name: 'location',
  type: 'point',
  label: 'Location',
}

// Query nearby
await payload.find({
  collection: 'stores',
  where: {
    location: {
      near: [-73.935242, 40.730610, 5000], // lng, lat, maxDistance (meters)
    },
  },
})
```

## Upload Fields

```ts
{
  name: 'featuredImage',
  type: 'upload',
  relationTo: 'media',
  required: true,
}
```

## Rich Text

```ts
{
  name: 'content',
  type: 'richText',
  // Lexical editor features configured in payload.config.ts
}
```

## UI Fields (Presentational)

Fields that don't save data:

```ts
// Row layout
{
  type: 'row',
  fields: [
    { name: 'firstName', type: 'text', admin: { width: '50%' } },
    { name: 'lastName', type: 'text', admin: { width: '50%' } },
  ],
}

// Tabs
{
  type: 'tabs',
  tabs: [
    { label: 'Content', fields: [...] },
    { label: 'Meta', fields: [...] },
  ],
}

// Collapsible
{
  type: 'collapsible',
  label: 'Advanced Options',
  fields: [...],
}
```
