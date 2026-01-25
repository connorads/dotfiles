---
name: payload-cms
description: >
  Use when working with Payload CMS projects (payload.config.ts, collections, fields, hooks, access control, Payload API).
  Triggers on tasks involving: collection definitions, field configurations, hooks, access control, database queries,
  custom endpoints, authentication, file uploads, drafts/versions, live preview, or plugin development.
  Also use when debugging validation errors, security issues, relationship queries, transactions, or hook behavior.
author: payloadcms
version: 1.0.0
---

# Payload CMS Development

Payload is a Next.js native CMS with TypeScript-first architecture. This skill transfers expert knowledge for building collections, hooks, access control, and queries the right way.

## Mental Model

Think of Payload as **three interconnected layers**:

1. **Config Layer** → Collections, globals, fields define your schema
2. **Hook Layer** → Lifecycle events transform and validate data
3. **Access Layer** → Functions control who can do what

Every operation flows through: `Config → Access Check → Hook Chain → Database → Response Hooks`

## Quick Reference

| Task | Solution | Details |
|------|----------|---------|
| Auto-generate slugs | `slugField()` or beforeChange hook | [references/fields.md#slug-field] |
| Restrict by user | Access control with query constraint | [references/access-control.md] |
| Local API with auth | `user` + `overrideAccess: false` | [references/queries.md#local-api] |
| Draft/publish | `versions: { drafts: true }` | [references/collections.md#drafts] |
| Computed fields | `virtual: true` with afterRead hook | [references/fields.md#virtual] |
| Conditional fields | `admin.condition` | [references/fields.md#conditional] |
| Filter relationships | `filterOptions` on field | [references/fields.md#relationship] |
| Prevent hook loops | `req.context` flag | [references/hooks.md#context] |
| Transactions | Pass `req` to all operations | [references/hooks.md#transactions] |
| Background jobs | Jobs queue with tasks | [references/advanced.md#jobs] |

## Quick Start

```bash
npx create-payload-app@latest my-app
cd my-app
pnpm dev
```

### Minimal Config

```ts
import { buildConfig } from 'payload'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

export default buildConfig({
  admin: { user: 'users' },
  collections: [Users, Media, Posts],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET,
  typescript: { outputFile: 'payload-types.ts' },
  db: mongooseAdapter({ url: process.env.DATABASE_URL }),
})
```

## Core Patterns

### Collection Definition

```ts
import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'status', 'createdAt'],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'content', type: 'richText' },
    { name: 'author', type: 'relationship', relationTo: 'users' },
    { name: 'status', type: 'select', options: ['draft', 'published'], defaultValue: 'draft' },
  ],
  timestamps: true,
}
```

### Hook Pattern (Auto-slug)

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  hooks: {
    beforeChange: [
      async ({ data, operation }) => {
        if (operation === 'create' && data.title) {
          data.slug = data.title.toLowerCase().replace(/\s+/g, '-')
        }
        return data
      },
    ],
  },
  fields: [{ name: 'title', type: 'text', required: true }],
}
```

### Access Control Pattern

```ts
import type { Access } from 'payload'

// Type-safe: admin-only access
export const adminOnly: Access = ({ req }) => {
  return req.user?.roles?.includes('admin') ?? false
}

// Row-level: users see only their own posts
export const ownPostsOnly: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.roles?.includes('admin')) return true
  return { author: { equals: req.user.id } }
}
```

### Query Pattern

```ts
// Local API with access control
const posts = await payload.find({
  collection: 'posts',
  where: {
    status: { equals: 'published' },
    'author.name': { contains: 'john' },
  },
  depth: 2,
  limit: 10,
  sort: '-createdAt',
  user: req.user,
  overrideAccess: false, // CRITICAL: enforce permissions
})
```

## Critical Security Rules

### 1. Local API Access Control

**Default behavior bypasses ALL access control.** This is the #1 security mistake.

```ts
// ❌ SECURITY BUG: Access control bypassed even with user
await payload.find({ collection: 'posts', user: someUser })

// ✅ SECURE: Explicitly enforce permissions
await payload.find({
  collection: 'posts',
  user: someUser,
  overrideAccess: false, // REQUIRED
})
```

**Rule:** Use `overrideAccess: false` for any operation acting on behalf of a user.

### 2. Transaction Integrity

**Operations without `req` run in separate transactions.**

```ts
// ❌ DATA CORRUPTION: Separate transaction
hooks: {
  afterChange: [async ({ doc, req }) => {
    await req.payload.create({
      collection: 'audit-log',
      data: { docId: doc.id },
      // Missing req - breaks atomicity!
    })
  }]
}

// ✅ ATOMIC: Same transaction
hooks: {
  afterChange: [async ({ doc, req }) => {
    await req.payload.create({
      collection: 'audit-log',
      data: { docId: doc.id },
      req, // Maintains transaction
    })
  }]
}
```

**Rule:** Always pass `req` to nested operations in hooks.

### 3. Infinite Hook Loops

**Hooks triggering themselves create infinite loops.**

```ts
// ❌ INFINITE LOOP
hooks: {
  afterChange: [async ({ doc, req }) => {
    await req.payload.update({
      collection: 'posts',
      id: doc.id,
      data: { views: doc.views + 1 },
      req,
    }) // Triggers afterChange again!
  }]
}

// ✅ SAFE: Context flag breaks the loop
hooks: {
  afterChange: [async ({ doc, req, context }) => {
    if (context.skipViewUpdate) return
    await req.payload.update({
      collection: 'posts',
      id: doc.id,
      data: { views: doc.views + 1 },
      req,
      context: { skipViewUpdate: true },
    })
  }]
}
```

## Project Structure

```
src/
├── app/
│   ├── (frontend)/page.tsx
│   └── (payload)/admin/[[...segments]]/page.tsx
├── collections/
│   ├── Posts.ts
│   ├── Media.ts
│   └── Users.ts
├── globals/Header.ts
├── hooks/slugify.ts
└── payload.config.ts
```

## Type Generation

Generate types after schema changes:

```ts
// payload.config.ts
export default buildConfig({
  typescript: { outputFile: 'payload-types.ts' },
})

// Usage
import type { Post, User } from '@/payload-types'
```

## Getting Payload Instance

```ts
// In API routes
import { getPayload } from 'payload'
import config from '@payload-config'

export async function GET() {
  const payload = await getPayload({ config })
  const posts = await payload.find({ collection: 'posts' })
  return Response.json(posts)
}

// In Server Components
export default async function Page() {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'posts' })
  return <div>{docs.map(p => <h1 key={p.id}>{p.title}</h1>)}</div>
}
```

## Common Field Types

```ts
// Text
{ name: 'title', type: 'text', required: true }

// Relationship
{ name: 'author', type: 'relationship', relationTo: 'users' }

// Rich text
{ name: 'content', type: 'richText' }

// Select
{ name: 'status', type: 'select', options: ['draft', 'published'] }

// Upload
{ name: 'image', type: 'upload', relationTo: 'media' }

// Array
{
  name: 'tags',
  type: 'array',
  fields: [{ name: 'tag', type: 'text' }],
}

// Blocks (polymorphic content)
{
  name: 'layout',
  type: 'blocks',
  blocks: [HeroBlock, ContentBlock, CTABlock],
}
```

## Decision Framework

**When choosing between approaches:**

| Scenario | Approach |
|----------|----------|
| Data transformation before save | `beforeChange` hook |
| Data transformation after read | `afterRead` hook |
| Enforce business rules | Access control function |
| Complex validation | `validate` function on field |
| Computed display value | Virtual field with `afterRead` |
| Related docs list | `join` field type |
| Side effects (email, webhook) | `afterChange` hook with context guard |
| Database-level constraint | Field with `unique: true` or `index: true` |

## Quality Checks

Good Payload code:
- [ ] All Local API calls with user context use `overrideAccess: false`
- [ ] All hook operations pass `req` for transaction integrity
- [ ] Recursive hooks use `context` flags
- [ ] Types generated and imported from `payload-types.ts`
- [ ] Access control functions are typed with `Access` type
- [ ] Collections have meaningful `admin.useAsTitle` set

## Reference Documentation

For detailed patterns, see:
- **[references/fields.md](references/fields.md)** - All field types, validation, conditional logic
- **[references/collections.md](references/collections.md)** - Auth, uploads, drafts, live preview
- **[references/hooks.md](references/hooks.md)** - Hook lifecycle, context, patterns
- **[references/access-control.md](references/access-control.md)** - RBAC, row-level, field-level
- **[references/queries.md](references/queries.md)** - Operators, Local/REST/GraphQL APIs
- **[references/advanced.md](references/advanced.md)** - Jobs, plugins, localization

## Resources

- Docs: https://payloadcms.com/docs
- LLM Context: https://payloadcms.com/llms-full.txt
- GitHub: https://github.com/payloadcms/payload
- Templates: https://github.com/payloadcms/payload/tree/main/templates
-e 

---

# Detailed Reference Documentation

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
-e 

---

# Collections Reference

## Basic Collection Config

```ts
import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'status', 'createdAt'],
    group: 'Content', // Groups in sidebar
  },
  fields: [...],
  timestamps: true, // Adds createdAt, updatedAt
}
```

## Auth Collection

Enable authentication on a collection:

```ts
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    tokenExpiration: 7200, // 2 hours
    verify: true, // Email verification
    maxLoginAttempts: 5,
    lockTime: 600 * 1000, // 10 min lockout
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'editor', 'user'],
      defaultValue: ['user'],
    },
  ],
}
```

## Upload Collection

Handle file uploads:

```ts
export const Media: CollectionConfig = {
  slug: 'media',
  upload: {
    staticDir: 'media',
    mimeTypes: ['image/*', 'application/pdf'],
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 768, height: 1024, position: 'centre' },
    ],
    adminThumbnail: 'thumbnail',
  },
  fields: [
    { name: 'alt', type: 'text', required: true },
    { name: 'caption', type: 'textarea' },
  ],
}
```

## Versioning & Drafts

Enable draft/publish workflow:

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  versions: {
    drafts: true,
    maxPerDoc: 10, // Keep last 10 versions
  },
  fields: [...],
}
```

Query drafts:

```ts
// Get published only (default)
await payload.find({ collection: 'posts' })

// Include drafts
await payload.find({ collection: 'posts', draft: true })
```

## Live Preview

Real-time preview for frontend:

```ts
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    livePreview: {
      url: ({ data }) => `${process.env.NEXT_PUBLIC_URL}/preview/${data.slug}`,
    },
  },
  versions: { drafts: true },
  fields: [...],
}
```

## Access Control

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    create: ({ req }) => !!req.user, // Logged in users
    read: () => true, // Public read
    update: ({ req }) => req.user?.roles?.includes('admin'),
    delete: ({ req }) => req.user?.roles?.includes('admin'),
  },
  fields: [...],
}
```

## Hooks Configuration

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  hooks: {
    beforeValidate: [...],
    beforeChange: [...],
    afterChange: [...],
    beforeRead: [...],
    afterRead: [...],
    beforeDelete: [...],
    afterDelete: [...],
    // Auth-only hooks
    afterLogin: [...],
    afterLogout: [...],
    afterMe: [...],
    afterRefresh: [...],
    afterForgotPassword: [...],
  },
  fields: [...],
}
```

## Custom Endpoints

Add API routes to a collection:

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  endpoints: [
    {
      path: '/publish/:id',
      method: 'post',
      handler: async (req) => {
        const { id } = req.routeParams
        await req.payload.update({
          collection: 'posts',
          id,
          data: { status: 'published', publishedAt: new Date() },
          req,
        })
        return Response.json({ success: true })
      },
    },
  ],
  fields: [...],
}
```

## Admin Panel Options

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'createdAt'],
    group: 'Content',
    description: 'Manage blog posts',
    hidden: false, // Hide from sidebar
    listSearchableFields: ['title', 'slug'],
    pagination: {
      defaultLimit: 20,
      limits: [10, 20, 50, 100],
    },
    preview: (doc) => `${process.env.NEXT_PUBLIC_URL}/${doc.slug}`,
  },
  fields: [...],
}
```

## Labels & Localization

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: {
    singular: 'Article',
    plural: 'Articles',
  },
  fields: [...],
}
```

## Database Indexes

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  fields: [
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'publishedAt', type: 'date', index: true },
  ],
  // Compound indexes via dbName
  dbName: 'posts',
}
```

## Disable Operations

```ts
export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  admin: {
    enableRichTextRelationship: false,
  },
  disableDuplicate: true, // No duplicate button
  fields: [...],
}
```

## Full Example

```ts
import type { CollectionConfig } from 'payload'
import { slugField } from './fields/slugField'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', 'status', 'publishedAt'],
    group: 'Content',
    livePreview: {
      url: ({ data }) => `${process.env.NEXT_PUBLIC_URL}/posts/${data.slug}`,
    },
  },
  access: {
    create: ({ req }) => !!req.user,
    read: ({ req }) => {
      if (req.user?.roles?.includes('admin')) return true
      return { status: { equals: 'published' } }
    },
    update: ({ req }) => {
      if (req.user?.roles?.includes('admin')) return true
      return { author: { equals: req.user?.id } }
    },
    delete: ({ req }) => req.user?.roles?.includes('admin'),
  },
  versions: {
    drafts: true,
    maxPerDoc: 10,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation }) => {
        if (operation === 'create') {
          data.slug = data.title?.toLowerCase().replace(/\s+/g, '-')
        }
        if (data.status === 'published' && !data.publishedAt) {
          data.publishedAt = new Date()
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true },
    { name: 'content', type: 'richText', required: true },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      defaultValue: ({ user }) => user?.id,
    },
    {
      name: 'status',
      type: 'select',
      options: ['draft', 'published', 'archived'],
      defaultValue: 'draft',
    },
    { name: 'publishedAt', type: 'date' },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
    },
  ],
  timestamps: true,
}
```
-e 

---

# Hooks Reference

## Hook Lifecycle

```
Operation: CREATE
  beforeOperation → beforeValidate → beforeChange → [DB Write] → afterChange → afterOperation

Operation: UPDATE
  beforeOperation → beforeValidate → beforeChange → [DB Write] → afterChange → afterOperation

Operation: READ
  beforeOperation → beforeRead → [DB Read] → afterRead → afterOperation

Operation: DELETE
  beforeOperation → beforeDelete → [DB Delete] → afterDelete → afterOperation
```

## Collection Hooks

### beforeValidate

Transform data before validation runs:

```ts
hooks: {
  beforeValidate: [
    async ({ data, operation, req }) => {
      if (operation === 'create') {
        data.createdBy = req.user?.id
      }
      return data // Always return data
    },
  ],
}
```

### beforeChange

Transform data before database write (after validation):

```ts
hooks: {
  beforeChange: [
    async ({ data, operation, originalDoc, req }) => {
      // Auto-generate slug on create
      if (operation === 'create' && data.title) {
        data.slug = data.title.toLowerCase().replace(/\s+/g, '-')
      }

      // Track last modified by
      data.lastModifiedBy = req.user?.id

      return data
    },
  ],
}
```

### afterChange

Side effects after database write:

```ts
hooks: {
  afterChange: [
    async ({ doc, operation, req, context }) => {
      // Prevent infinite loops
      if (context.skipAuditLog) return doc

      // Create audit log entry
      await req.payload.create({
        collection: 'audit-logs',
        data: {
          action: operation,
          collection: 'posts',
          documentId: doc.id,
          userId: req.user?.id,
          timestamp: new Date(),
        },
        req, // CRITICAL: maintains transaction
        context: { skipAuditLog: true },
      })

      return doc
    },
  ],
}
```

### beforeRead

Modify query before database read:

```ts
hooks: {
  beforeRead: [
    async ({ doc, req }) => {
      // doc is the raw database document
      // Can modify before afterRead transforms
      return doc
    },
  ],
}
```

### afterRead

Transform data before sending to client:

```ts
hooks: {
  afterRead: [
    async ({ doc, req }) => {
      // Add computed field
      doc.fullName = `${doc.firstName} ${doc.lastName}`

      // Hide sensitive data for non-admins
      if (!req.user?.roles?.includes('admin')) {
        delete doc.internalNotes
      }

      return doc
    },
  ],
}
```

### beforeDelete

Pre-delete validation or cleanup:

```ts
hooks: {
  beforeDelete: [
    async ({ id, req }) => {
      // Cascading delete: remove related comments
      await req.payload.delete({
        collection: 'comments',
        where: { post: { equals: id } },
        req,
      })
    },
  ],
}
```

### afterDelete

Post-delete cleanup:

```ts
hooks: {
  afterDelete: [
    async ({ doc, req }) => {
      // Clean up uploaded files
      if (doc.image) {
        await deleteFile(doc.image.filename)
      }
    },
  ],
}
```

## Field Hooks

Hooks on individual fields:

```ts
{
  name: 'slug',
  type: 'text',
  hooks: {
    beforeValidate: [
      ({ value, data }) => {
        if (!value && data?.title) {
          return data.title.toLowerCase().replace(/\s+/g, '-')
        }
        return value
      },
    ],
    afterRead: [
      ({ value }) => value?.toLowerCase(),
    ],
  },
}
```

## Context Pattern

**Prevent infinite loops and share state between hooks:**

```ts
hooks: {
  afterChange: [
    async ({ doc, req, context }) => {
      // Check context flag to prevent loops
      if (context.skipNotification) return doc

      // Trigger related update with context flag
      await req.payload.update({
        collection: 'related',
        id: doc.relatedId,
        data: { updated: true },
        req,
        context: {
          ...context,
          skipNotification: true, // Prevent loop
        },
      })

      return doc
    },
  ],
}
```

## Transactions

**CRITICAL: Always pass `req` for transaction integrity:**

```ts
hooks: {
  afterChange: [
    async ({ doc, req }) => {
      // ✅ Same transaction - atomic
      await req.payload.create({
        collection: 'audit-logs',
        data: { documentId: doc.id },
        req, // REQUIRED
      })

      // ❌ Separate transaction - can leave inconsistent state
      await req.payload.create({
        collection: 'audit-logs',
        data: { documentId: doc.id },
        // Missing req!
      })

      return doc
    },
  ],
}
```

## Next.js Revalidation with Context Control

```ts
import { revalidatePath, revalidateTag } from 'next/cache'

hooks: {
  afterChange: [
    async ({ doc, context }) => {
      // Skip revalidation for internal updates
      if (context.skipRevalidation) return doc

      revalidatePath(`/posts/${doc.slug}`)
      revalidateTag('posts')

      return doc
    },
  ],
}
```

## Auth Hooks (Auth Collections Only)

```ts
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  hooks: {
    afterLogin: [
      async ({ doc, req }) => {
        // Log login
        await req.payload.create({
          collection: 'login-logs',
          data: { userId: doc.id, timestamp: new Date() },
          req,
        })
        return doc
      },
    ],
    afterLogout: [
      async ({ req }) => {
        // Clear session data
      },
    ],
    afterMe: [
      async ({ doc, req }) => {
        // Add extra user info
        return doc
      },
    ],
    afterRefresh: [
      async ({ doc, req }) => {
        // Custom token refresh logic
        return doc
      },
    ],
    afterForgotPassword: [
      async ({ args }) => {
        // Custom forgot password notification
      },
    ],
  },
  fields: [...],
}
```

## Hook Arguments Reference

All hooks receive these base arguments:

| Argument | Description |
|----------|-------------|
| `req` | Request object with `payload`, `user`, `locale` |
| `context` | Shared context object between hooks |
| `collection` | Collection config |

Operation-specific arguments:

| Hook | Additional Arguments |
|------|---------------------|
| `beforeValidate` | `data`, `operation`, `originalDoc` |
| `beforeChange` | `data`, `operation`, `originalDoc` |
| `afterChange` | `doc`, `operation`, `previousDoc` |
| `beforeRead` | `doc` |
| `afterRead` | `doc` |
| `beforeDelete` | `id` |
| `afterDelete` | `doc`, `id` |

## Best Practices

1. **Always return the data/doc** - Even if unchanged
2. **Use context for loop prevention** - Check before triggering recursive operations
3. **Pass req for transactions** - Maintains atomicity
4. **Keep hooks focused** - One responsibility per hook
5. **Use field hooks for field-specific logic** - Better encapsulation
6. **Avoid heavy operations in beforeRead** - Runs on every query
7. **Use afterChange for side effects** - Email, webhooks, etc.
-e 

---

# Access Control Reference

## Overview

Access control functions determine WHO can do WHAT with documents:

```ts
type Access = (args: AccessArgs) => boolean | Where | Promise<boolean | Where>
```

Returns:
- `true` - Full access
- `false` - No access
- `Where` query - Filtered access (row-level security)

## Collection-Level Access

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    create: isLoggedIn,
    read: isPublishedOrAdmin,
    update: isAdminOrAuthor,
    delete: isAdmin,
  },
  fields: [...],
}
```

## Common Patterns

### Public Read, Admin Write

```ts
const isAdmin: Access = ({ req }) => {
  return req.user?.roles?.includes('admin') ?? false
}

const isLoggedIn: Access = ({ req }) => {
  return !!req.user
}

access: {
  create: isLoggedIn,
  read: () => true, // Public
  update: isAdmin,
  delete: isAdmin,
}
```

### Row-Level Security (User's Own Documents)

```ts
const ownDocsOnly: Access = ({ req }) => {
  if (!req.user) return false

  // Admins see everything
  if (req.user.roles?.includes('admin')) return true

  // Others see only their own
  return {
    author: { equals: req.user.id },
  }
}

access: {
  read: ownDocsOnly,
  update: ownDocsOnly,
  delete: ownDocsOnly,
}
```

### Complex Queries

```ts
const publishedOrOwn: Access = ({ req }) => {
  // Not logged in: published only
  if (!req.user) {
    return { status: { equals: 'published' } }
  }

  // Admin: see all
  if (req.user.roles?.includes('admin')) return true

  // Others: published OR own drafts
  return {
    or: [
      { status: { equals: 'published' } },
      { author: { equals: req.user.id } },
    ],
  }
}
```

## Field-Level Access

Control access to specific fields:

```ts
{
  name: 'internalNotes',
  type: 'textarea',
  access: {
    read: ({ req }) => req.user?.roles?.includes('admin'),
    update: ({ req }) => req.user?.roles?.includes('admin'),
  },
}
```

### Hide Field Completely

```ts
{
  name: 'secretKey',
  type: 'text',
  access: {
    read: () => false, // Never returned in API
    update: ({ req }) => req.user?.roles?.includes('admin'),
  },
}
```

## Access Control Arguments

```ts
type AccessArgs = {
  req: PayloadRequest
  id?: string | number  // Document ID (for update/delete)
  data?: Record<string, unknown>  // Incoming data (for create/update)
}
```

## RBAC (Role-Based Access Control)

```ts
// Define roles
type Role = 'admin' | 'editor' | 'author' | 'subscriber'

// Helper functions
const hasRole = (req: PayloadRequest, role: Role): boolean => {
  return req.user?.roles?.includes(role) ?? false
}

const hasAnyRole = (req: PayloadRequest, roles: Role[]): boolean => {
  return roles.some(role => hasRole(req, role))
}

// Use in access control
const canEdit: Access = ({ req }) => {
  return hasAnyRole(req, ['admin', 'editor'])
}

const canPublish: Access = ({ req }) => {
  return hasAnyRole(req, ['admin', 'editor'])
}

const canDelete: Access = ({ req }) => {
  return hasRole(req, 'admin')
}
```

## Multi-Tenant Access

```ts
// Users belong to organizations
const sameOrgOnly: Access = ({ req }) => {
  if (!req.user) return false

  // Super admin sees all
  if (req.user.roles?.includes('super-admin')) return true

  // Others see only their org's data
  return {
    organization: { equals: req.user.organization },
  }
}

// Apply to collection
access: {
  create: ({ req }) => !!req.user,
  read: sameOrgOnly,
  update: sameOrgOnly,
  delete: sameOrgOnly,
}
```

## Global Access

For singleton documents:

```ts
export const Settings: GlobalConfig = {
  slug: 'settings',
  access: {
    read: () => true,
    update: ({ req }) => req.user?.roles?.includes('admin'),
  },
  fields: [...],
}
```

## Important: Local API Access Control

**Local API bypasses access control by default!**

```ts
// ❌ SECURITY BUG: Access control bypassed
await payload.find({
  collection: 'posts',
  user: someUser,
})

// ✅ SECURE: Explicitly enforce access control
await payload.find({
  collection: 'posts',
  user: someUser,
  overrideAccess: false, // REQUIRED
})
```

## Access Control with req.context

Share state between access checks and hooks:

```ts
const conditionalAccess: Access = ({ req }) => {
  // Check context set by middleware or previous operation
  if (req.context?.bypassAuth) return true

  return req.user?.roles?.includes('admin')
}
```

## Best Practices

1. **Default to restrictive** - Start with `false`, add permissions
2. **Use query constraints for row-level** - More efficient than filtering after
3. **Keep logic in reusable functions** - DRY across collections
4. **Test with different user types** - Admin, regular user, anonymous
5. **Remember Local API default** - Always use `overrideAccess: false` for user-facing operations
6. **Document your access rules** - Complex logic needs comments
-e 

---

# Queries Reference

## Local API

### Find Multiple

```ts
const result = await payload.find({
  collection: 'posts',
  where: {
    status: { equals: 'published' },
  },
  limit: 10,
  page: 1,
  sort: '-createdAt',
  depth: 2,
})

// Result structure
{
  docs: Post[],
  totalDocs: number,
  limit: number,
  totalPages: number,
  page: number,
  pagingCounter: number,
  hasPrevPage: boolean,
  hasNextPage: boolean,
  prevPage: number | null,
  nextPage: number | null,
}
```

### Find By ID

```ts
const post = await payload.findByID({
  collection: 'posts',
  id: '123',
  depth: 2,
})
```

### Create

```ts
const newPost = await payload.create({
  collection: 'posts',
  data: {
    title: 'New Post',
    content: '...',
    author: userId,
  },
  user: req.user, // For access control
})
```

### Update

```ts
const updated = await payload.update({
  collection: 'posts',
  id: '123',
  data: {
    title: 'Updated Title',
  },
})
```

### Delete

```ts
const deleted = await payload.delete({
  collection: 'posts',
  id: '123',
})
```

## Query Operators

### Comparison

```ts
where: {
  price: { equals: 100 },
  price: { not_equals: 100 },
  price: { greater_than: 100 },
  price: { greater_than_equal: 100 },
  price: { less_than: 100 },
  price: { less_than_equal: 100 },
}
```

### String Operations

```ts
where: {
  title: { like: 'Hello' },        // Case-insensitive contains
  title: { contains: 'world' },    // Case-sensitive contains
  email: { exists: true },         // Field has value
}
```

### Array Operations

```ts
where: {
  tags: { in: ['tech', 'design'] },      // Value in array
  tags: { not_in: ['spam'] },            // Value not in array
  tags: { all: ['featured', 'popular'] }, // Has all values
}
```

### AND/OR Logic

```ts
where: {
  and: [
    { status: { equals: 'published' } },
    { author: { equals: userId } },
  ],
}

where: {
  or: [
    { status: { equals: 'published' } },
    { author: { equals: userId } },
  ],
}

// Nested
where: {
  and: [
    { status: { equals: 'published' } },
    {
      or: [
        { featured: { equals: true } },
        { 'author.roles': { in: ['admin'] } },
      ],
    },
  ],
}
```

### Nested Properties

Query through relationships:

```ts
where: {
  'author.name': { contains: 'John' },
  'category.slug': { equals: 'tech' },
}
```

### Geospatial Queries

```ts
where: {
  location: {
    near: [-73.935242, 40.730610, 10000], // [lng, lat, maxDistanceMeters]
  },
}

where: {
  location: {
    within: {
      type: 'Polygon',
      coordinates: [[[-74, 40], [-73, 40], [-73, 41], [-74, 41], [-74, 40]]],
    },
  },
}
```

## Field Selection

Only fetch specific fields:

```ts
const posts = await payload.find({
  collection: 'posts',
  select: {
    title: true,
    slug: true,
    author: true, // Will be populated based on depth
  },
})
```

## Depth (Relationship Population)

```ts
// depth: 0 - IDs only
{ author: '123' }

// depth: 1 - First level populated
{ author: { id: '123', name: 'John' } }

// depth: 2 (default) - Nested relationships populated
{ author: { id: '123', name: 'John', avatar: { url: '...' } } }
```

## Pagination

```ts
// Page-based
await payload.find({
  collection: 'posts',
  page: 2,
  limit: 20,
})

// Cursor-based (more efficient for large datasets)
await payload.find({
  collection: 'posts',
  where: {
    createdAt: { greater_than: lastCursor },
  },
  limit: 20,
  sort: 'createdAt',
})
```

## Sorting

```ts
// Single field
sort: 'createdAt'      // Ascending
sort: '-createdAt'     // Descending

// Multiple fields
sort: ['-featured', '-createdAt']
```

## Access Control in Local API

**CRITICAL: Local API bypasses access control by default!**

```ts
// ❌ INSECURE: Access control bypassed
await payload.find({
  collection: 'posts',
  user: someUser, // User is ignored!
})

// ✅ SECURE: Access control enforced
await payload.find({
  collection: 'posts',
  user: someUser,
  overrideAccess: false, // REQUIRED
})
```

## REST API

### Endpoints

```
GET    /api/{collection}              # Find
GET    /api/{collection}/{id}         # Find by ID
POST   /api/{collection}              # Create
PATCH  /api/{collection}/{id}         # Update
DELETE /api/{collection}/{id}         # Delete
```

### Query String

```
GET /api/posts?where[status][equals]=published&limit=10&sort=-createdAt&depth=2
```

### Nested Queries

```
GET /api/posts?where[author.name][contains]=John
```

### Complex Queries

```
GET /api/posts?where[or][0][status][equals]=published&where[or][1][author][equals]=123
```

## GraphQL API

### Query

```graphql
query {
  Posts(
    where: { status: { equals: published } }
    limit: 10
    sort: "-createdAt"
  ) {
    docs {
      id
      title
      author {
        name
      }
    }
    totalDocs
  }
}
```

### Mutation

```graphql
mutation {
  createPost(data: { title: "New Post", status: draft }) {
    id
    title
  }
}
```

## Draft Queries

```ts
// Published only (default)
await payload.find({ collection: 'posts' })

// Include drafts
await payload.find({
  collection: 'posts',
  draft: true,
})
```

## Count Only

```ts
const count = await payload.count({
  collection: 'posts',
  where: { status: { equals: 'published' } },
})
// Returns: { totalDocs: number }
```

## Distinct Values

```ts
const categories = await payload.find({
  collection: 'posts',
  select: { category: true },
  // Then dedupe in code
})
```

## Performance Tips

1. **Use indexes** - Add `index: true` to frequently queried fields
2. **Limit depth** - Lower depth = faster queries
3. **Select specific fields** - Don't fetch what you don't need
4. **Use pagination** - Never fetch all documents
5. **Avoid nested OR queries** - Can be slow on large collections
6. **Use count for totals** - Faster than fetching all docs
-e 

---

# Advanced Features Reference

## Jobs Queue

Background task processing:

### Define Tasks

```ts
// payload.config.ts
export default buildConfig({
  jobs: {
    tasks: [
      {
        slug: 'sendEmail',
        handler: async ({ payload, job }) => {
          const { to, subject, body } = job.input
          await sendEmail({ to, subject, body })
        },
        inputSchema: {
          to: { type: 'text', required: true },
          subject: { type: 'text', required: true },
          body: { type: 'text', required: true },
        },
      },
      {
        slug: 'generateThumbnails',
        handler: async ({ payload, job }) => {
          const { mediaId } = job.input
          // Process images...
        },
      },
    ],
  },
})
```

### Queue Jobs

```ts
// In a hook or endpoint
await payload.jobs.queue({
  task: 'sendEmail',
  input: {
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Thanks for signing up.',
  },
})
```

### Run Jobs

```bash
# In production, run job worker
payload jobs:run
```

## Custom Endpoints

### Collection Endpoints

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  endpoints: [
    {
      path: '/publish/:id',
      method: 'post',
      handler: async (req) => {
        const { id } = req.routeParams

        const doc = await req.payload.update({
          collection: 'posts',
          id,
          data: {
            status: 'published',
            publishedAt: new Date(),
          },
          req,
          overrideAccess: false, // Respect permissions
        })

        return Response.json({ success: true, doc })
      },
    },
    {
      path: '/stats',
      method: 'get',
      handler: async (req) => {
        const total = await req.payload.count({ collection: 'posts' })
        const published = await req.payload.count({
          collection: 'posts',
          where: { status: { equals: 'published' } },
        })

        return Response.json({
          total: total.totalDocs,
          published: published.totalDocs,
        })
      },
    },
  ],
}
```

### Global Endpoints

```ts
// payload.config.ts
export default buildConfig({
  endpoints: [
    {
      path: '/health',
      method: 'get',
      handler: async () => {
        return Response.json({ status: 'ok' })
      },
    },
  ],
})
```

## Plugins

### Using Plugins

```ts
import { buildConfig } from 'payload'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'

export default buildConfig({
  plugins: [
    seoPlugin({
      collections: ['posts', 'pages'],
      uploadsCollection: 'media',
    }),
    formBuilderPlugin({
      fields: {
        text: true,
        email: true,
        textarea: true,
      },
    }),
  ],
})
```

### Creating Plugins

```ts
import type { Config, Plugin } from 'payload'

type MyPluginOptions = {
  enabled?: boolean
  collections?: string[]
}

export const myPlugin = (options: MyPluginOptions): Plugin => {
  return (incomingConfig: Config): Config => {
    const { enabled = true, collections = [] } = options

    if (!enabled) return incomingConfig

    return {
      ...incomingConfig,
      collections: (incomingConfig.collections || []).map((collection) => {
        if (!collections.includes(collection.slug)) return collection

        return {
          ...collection,
          fields: [
            ...collection.fields,
            {
              name: 'pluginField',
              type: 'text',
              admin: { position: 'sidebar' },
            },
          ],
        }
      }),
    }
  }
}
```

## Localization

### Enable Localization

```ts
export default buildConfig({
  localization: {
    locales: [
      { label: 'English', code: 'en' },
      { label: 'Spanish', code: 'es' },
      { label: 'French', code: 'fr' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
})
```

### Localized Fields

```ts
{
  name: 'title',
  type: 'text',
  localized: true, // Enable per-locale values
}
```

### Query by Locale

```ts
// Local API
const posts = await payload.find({
  collection: 'posts',
  locale: 'es',
})

// REST API
GET /api/posts?locale=es

// Get all locales
const posts = await payload.find({
  collection: 'posts',
  locale: 'all',
})
```

## Custom Components

### Field Components

```ts
// components/CustomTextField.tsx
'use client'

import { useField } from '@payloadcms/ui'

export const CustomTextField: React.FC = () => {
  const { value, setValue } = useField()

  return (
    <input
      value={value || ''}
      onChange={(e) => setValue(e.target.value)}
    />
  )
}

// In field config
{
  name: 'customField',
  type: 'text',
  admin: {
    components: {
      Field: '/components/CustomTextField',
    },
  },
}
```

### Custom Views

```ts
// Add custom admin page
admin: {
  components: {
    views: {
      Dashboard: '/components/CustomDashboard',
    },
  },
}
```

## Authentication

### Custom Auth Strategies

```ts
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    strategies: [
      {
        name: 'api-key',
        authenticate: async ({ headers, payload }) => {
          const apiKey = headers.get('x-api-key')

          if (!apiKey) return { user: null }

          const user = await payload.find({
            collection: 'users',
            where: { apiKey: { equals: apiKey } },
          })

          return { user: user.docs[0] || null }
        },
      },
    ],
  },
}
```

### Token Customization

```ts
auth: {
  tokenExpiration: 7200, // 2 hours
  cookies: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN,
  },
}
```

## Database Adapters

### MongoDB

```ts
import { mongooseAdapter } from '@payloadcms/db-mongodb'

db: mongooseAdapter({
  url: process.env.DATABASE_URL,
  transactionOptions: {
    maxCommitTimeMS: 30000,
  },
})
```

### PostgreSQL

```ts
import { postgresAdapter } from '@payloadcms/db-postgres'

db: postgresAdapter({
  pool: {
    connectionString: process.env.DATABASE_URL,
  },
})
```

## Storage Adapters

### S3

```ts
import { s3Storage } from '@payloadcms/storage-s3'

plugins: [
  s3Storage({
    collections: { media: true },
    bucket: process.env.S3_BUCKET,
    config: {
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
      region: process.env.S3_REGION,
    },
  }),
]
```

### Vercel Blob

```ts
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'

plugins: [
  vercelBlobStorage({
    collections: { media: true },
    token: process.env.BLOB_READ_WRITE_TOKEN,
  }),
]
```

## Email Adapters

```ts
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

email: nodemailerAdapter({
  defaultFromAddress: 'noreply@example.com',
  defaultFromName: 'My App',
  transport: {
    host: process.env.SMTP_HOST,
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },
})
```
