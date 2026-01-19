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
