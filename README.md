# Status Global MCP Server

[![npm](https://img.shields.io/npm/v/status-global-mcp)](https://www.npmjs.com/package/status-global-mcp)

[MCP](https://modelcontextprotocol.io) server for [Status Global](https://status.dragnoc.fr) — run web audits (performance, security, SEO, DNS) and get AI-ready improvement prompts directly in Claude Code, ChatGPT, or any MCP client.

## Installation

**One command:**

```bash
claude mcp add status-global -- npx status-global-mcp
```

That's it. When you first use it, Claude will guide you to get an API key and configure it automatically.

You can also provide the key directly:

```bash
claude mcp add status-global -e STATUS_GLOBAL_API_KEY=YOUR_KEY -- npx status-global-mcp
```

Now in Claude Code, just say:

```
Audit my website https://example.com and fix the issues
```

## How it works

1. You ask Claude to audit a URL
2. Status Global runs **100 analysis modules** across 5 categories
3. The MCP server returns a structured improvement prompt
4. Claude reads your codebase and applies fixes by priority

## Tools

### `audit_website`

Runs a full web audit and returns a structured improvement prompt.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL to audit (e.g., `https://example.com`) |
| `server` | No | Test server code (defaults to first available) |
| `format` | No | `prompt` (default), `summary`, or `full` |

### `get_report`

Retrieves an existing audit report by job ID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `job_id` | Yes | Job ID (ULID from a previous audit) |
| `format` | No | `prompt` (default), `summary`, or `full` |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STATUS_GLOBAL_API_KEY` | Yes | Your API key ([get one here](https://status.dragnoc.fr/app/account)) |
| `STATUS_GLOBAL_URL` | No | Custom API URL (default: `https://status.dragnoc.fr`) |

### Manual setup (alternative)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "status-global": {
      "command": "npx",
      "args": ["status-global-mcp"],
      "env": {
        "STATUS_GLOBAL_API_KEY": "your_key_here"
      }
    }
  }
}
```

## What does it audit?

- **Performance** (15 modules) — Cache, compression, images, fonts, HTTP/2, Core Web Vitals...
- **Security** (16 modules) — TLS, headers, mixed content, data leaks, GDPR cookies...
- **SEO** (11 modules) — Meta tags, Open Graph, sitemap, robots.txt, structured data...
- **Advanced** (8 modules) — PageSpeed, AI review, JS/CSS coverage, carbon footprint...
- **Domain/DNS** (20 modules) — DNSSEC, SPF/DKIM/DMARC, MX, NS, expiry, IPv6...

## License

MIT
