# Status Global MCP Server

[MCP](https://modelcontextprotocol.io) server for [Status Global](https://status-global.fr) — run web audits (performance, security, SEO, DNS) and get AI-ready improvement prompts directly in Claude Code, ChatGPT, or any MCP client.

## Quick Start

### 1. Get your API key

1. Create an account at [status-global.fr](https://status-global.fr)
2. Go to **My Account → API Key → Generate**
3. Copy your key

### 2. Add to Claude Code

```bash
claude mcp add status-global -- npx @status-global/mcp-server
```

Then set your API key:

```json
{
  "mcpServers": {
    "status-global": {
      "command": "npx",
      "args": ["@status-global/mcp-server"],
      "env": {
        "STATUS_GLOBAL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 3. Use it

In Claude Code, just say:

```
Audit my website https://example.com and fix the issues
```

Claude will:
1. Run a full audit (100 modules across 5 categories)
2. Get the structured improvement prompt
3. Read your codebase and apply fixes by priority

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

### `list_servers`

Lists available test servers.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STATUS_GLOBAL_API_KEY` | Yes | Your API key from status-global.fr |
| `STATUS_GLOBAL_URL` | No | Custom API base URL (default: `https://status-global.fr`) |

## What does it audit?

Status Global runs **100 analysis modules** across 5 categories:

- **Performance** (15 modules) — Cache, compression, images, fonts, HTTP/2, Core Web Vitals...
- **Security** (16 modules) — TLS, headers, mixed content, data leaks, GDPR cookies...
- **SEO** (11 modules) — Meta tags, Open Graph, sitemap, robots.txt, structured data...
- **Advanced** (8 modules) — PageSpeed, AI review, JS/CSS coverage, carbon footprint...
- **Domain/DNS** (20 modules) — DNSSEC, SPF/DKIM/DMARC, MX, NS, expiry, IPv6...

## License

MIT
