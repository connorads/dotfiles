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
