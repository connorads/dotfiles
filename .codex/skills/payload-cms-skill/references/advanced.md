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
