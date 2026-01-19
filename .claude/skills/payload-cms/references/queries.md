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
