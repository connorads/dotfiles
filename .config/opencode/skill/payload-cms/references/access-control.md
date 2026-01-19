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
