# Payload CMS Agent Skill

React and Next.js CMS development guidelines optimized for AI agents and LLMs.

## Overview

This skill transfers expert knowledge for building Payload CMS applications. It covers:

- **Collections & Fields** - Schema design, field types, validation
- **Hooks** - Lifecycle events, data transformation, side effects  
- **Access Control** - RBAC, row-level security, field-level permissions
- **Queries** - Local API, REST, GraphQL with operators
- **Advanced** - Jobs, plugins, localization, custom components

## Installation

### Claude Code / OpenCode

```bash
npx add-skill https://github.com/connorads/dotfiles/tree/master/.claude/skills/payload-cms
```

### Claude.ai

Upload the `payload-cms.zip` file to Claude's Skills settings.

### Cursor

Copy `SKILL.md` content to `.cursor/rules/payload-cms.mdc`

### Manual

Place the skill folder in your agent's skills directory:

```
.claude/skills/payload-cms/
├── SKILL.md
├── AGENTS.md
└── references/
    ├── fields.md
    ├── collections.md
    ├── hooks.md
    ├── access-control.md
    ├── queries.md
    └── advanced.md
```

## Usage

The skill activates when working on tasks involving:

- `payload.config.ts` configuration
- Collection or global definitions
- Field configurations
- Hooks and lifecycle events
- Access control functions
- Database queries (Local API, REST, GraphQL)
- Custom endpoints
- Authentication setup
- File uploads
- Drafts and versioning
- Plugin development

## Examples

Ask your AI agent:

- "Create a Posts collection with draft/publish workflow"
- "Add access control so users only see their own documents"
- "Fix the infinite loop in my afterChange hook"
- "Query posts by nested author relationship"
- "Set up row-level multi-tenant access"

## Structure

| File | Purpose |
|------|---------|
| `SKILL.md` | Core instructions loaded on activation |
| `AGENTS.md` | Full compiled document for single-file agents |
| `references/` | Detailed docs loaded on demand |

## Key Security Patterns

The skill emphasizes three critical patterns:

1. **Local API Access Control** - Always use `overrideAccess: false` when acting on behalf of users
2. **Transaction Integrity** - Pass `req` to all nested operations in hooks
3. **Infinite Loop Prevention** - Use `context` flags for recursive operations

## Resources

- [Payload CMS Docs](https://payloadcms.com/docs)
- [LLM Context File](https://payloadcms.com/llms-full.txt)
- [GitHub Repository](https://github.com/payloadcms/payload)
- [Templates](https://github.com/payloadcms/payload/tree/main/templates)

## Credits

Based on the official [Payload CMS cursor rules](https://github.com/payloadcms/payload/tree/main/templates/_agents/rules) and documentation, adapted to the [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills) format.

## License

MIT
