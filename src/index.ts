#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.STATUS_GLOBAL_URL || "https://status-global.fr";
const API_KEY = process.env.STATUS_GLOBAL_API_KEY || "";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes max

interface JobResponse {
  ok: boolean;
  public_id?: string;
  url?: string;
  status?: string;
  status_text?: string;
  progress?: number;
  error_message?: string;
  report?: Report | null;
  server_code?: string;
  created_at?: string;
  finished_at?: string;
}

interface Report {
  scores?: Record<string, number>;
  modules?: Module[];
  target?: { url?: string; http_status?: number };
}

interface Module {
  id: string;
  title?: string;
  category?: string;
  score?: number;
  status?: string;
  summary?: string;
  recommendations?: string[];
  details?: Record<string, unknown>;
  premium?: boolean;
}

interface ServerEntry {
  code: string;
  name: string;
}

// ── API helpers ──

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function getServers(): Promise<ServerEntry[]> {
  const data = await apiRequest<{ ok: boolean; servers: ServerEntry[] }>("/api/servers");
  return data.servers || [];
}

async function createTest(url: string, serverCode: string): Promise<string> {
  const data = await apiRequest<{ ok: boolean; job_id?: string; error?: string }>(
    "/api/test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, server_code: serverCode }),
    }
  );

  if (!data.ok || !data.job_id) {
    throw new Error(data.error || "Failed to create test");
  }

  return data.job_id;
}

async function getJob(jobId: string): Promise<JobResponse> {
  return apiRequest<JobResponse>(`/api/job/${encodeURIComponent(jobId)}`);
}

async function pollUntilDone(jobId: string): Promise<JobResponse> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const job = await getJob(jobId);

    if (job.status === "done" || job.status === "error") {
      return job;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Audit timed out after 5 minutes");
}

// ── Prompt builder ──

const CAT_NAMES: Record<string, string> = {
  perf: "Performance",
  security: "Sécurité",
  seo: "SEO",
  advanced: "Avancé",
  domain: "Domain / DNS",
};

const CAT_ORDER = ["perf", "security", "seo", "advanced", "domain"];

function buildPrompt(report: Report, targetUrl: string): string {
  const scores = report.scores || {};
  const modules = report.modules || [];
  const lines: string[] = [];

  lines.push(`# Audit web — ${targetUrl}`);
  lines.push(`# Score global : ${scores.global || 0}/100`);
  lines.push(`# Généré par Status Global (https://status-global.fr)`);
  lines.push("");
  lines.push("## Résumé des scores");
  lines.push("");

  for (const cat of CAT_ORDER) {
    lines.push(`- **${CAT_NAMES[cat]}** : ${scores[cat] || 0}/100`);
  }

  lines.push("");
  lines.push("## Problèmes à corriger (par priorité)");

  for (const cat of CAT_ORDER) {
    const catModules = modules
      .filter(
        (m) =>
          m.category === cat &&
          (m.score || 0) < 100 &&
          m.status !== "requires_headless" &&
          m.status !== "requires_api"
      )
      .sort((a, b) => (a.score || 0) - (b.score || 0));

    if (!catModules.length) continue;

    lines.push("");
    lines.push(`### ${CAT_NAMES[cat]} (${scores[cat] || 0}/100)`);

    for (const m of catModules) {
      lines.push("");
      lines.push(`#### ${m.title || m.id} — ${m.score || 0}/100`);
      if (m.summary) lines.push(`> ${m.summary}`);

      const recos = m.recommendations || [];
      if (recos.length) {
        lines.push("");
        lines.push("**Recommandations :**");
        for (const r of recos) lines.push(`- ${r}`);
      }

      if (m.details && typeof m.details === "object" && Object.keys(m.details).length > 0) {
        lines.push("");
        lines.push("**Détails techniques :**");
        lines.push("```json");
        lines.push(JSON.stringify(m.details, null, 2));
        lines.push("```");
      }
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push(
    "Analyse le code source de ce site web et implémente les corrections listées ci-dessus par ordre de priorité (score le plus bas en premier)."
  );
  lines.push("");
  lines.push("Pour chaque correction :");
  lines.push("1. Explique brièvement ce que tu vas modifier et pourquoi");
  lines.push("2. Modifie le code nécessaire");
  lines.push("3. Vérifie qu'il n'y a pas d'effets de bord");
  lines.push("");
  lines.push(
    "Concentre-toi sur les modules avec un score inférieur à 70 en priorité. Les modules au-dessus de 70 peuvent être améliorés dans un second temps."
  );

  return lines.join("\n");
}

function buildSummary(report: Report, targetUrl: string): string {
  const scores = report.scores || {};
  const modules = report.modules || [];
  const issues = modules.filter(
    (m) =>
      (m.score || 0) < 70 &&
      m.status !== "requires_headless" &&
      m.status !== "requires_api"
  );

  let summary = `## Audit de ${targetUrl}\n\n`;
  summary += `**Score global : ${scores.global || 0}/100**\n\n`;
  summary += `| Catégorie | Score |\n|---|---|\n`;

  for (const cat of CAT_ORDER) {
    summary += `| ${CAT_NAMES[cat]} | ${scores[cat] || 0}/100 |\n`;
  }

  if (issues.length > 0) {
    summary += `\n**${issues.length} module(s) nécessitent une attention** (score < 70) :\n`;
    for (const m of issues.sort((a, b) => (a.score || 0) - (b.score || 0)).slice(0, 10)) {
      summary += `- ${m.title || m.id} : ${m.score || 0}/100\n`;
    }
    if (issues.length > 10) {
      summary += `- ... et ${issues.length - 10} autre(s)\n`;
    }
  }

  return summary;
}

// ── MCP Server ──

const server = new McpServer({
  name: "status-global",
  version: "1.0.0",
});

// Tool: audit a website
server.tool(
  "audit_website",
  "Lance un audit complet d'un site web (performance, sécurité, SEO, DNS) via Status Global et retourne un prompt structuré pour corriger les problèmes détectés. Nécessite une clé API Status Global.",
  {
    url: z.string().describe("URL du site web à auditer (ex: https://example.com)"),
    server: z.string().optional().describe("Code du serveur de test (ex: fr-1). Si omis, utilise le premier serveur disponible."),
    format: z
      .enum(["prompt", "summary", "full"])
      .optional()
      .describe("Format de sortie : 'prompt' (défaut) = prompt IA structuré, 'summary' = résumé concis, 'full' = rapport JSON complet"),
  },
  async ({ url, server: serverCode, format }) => {
    if (!API_KEY) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Clé API non configurée.\n\n1. Créez un compte sur ${API_BASE}\n2. Allez dans Mon Compte → Clé API → Générer\n3. Configurez la variable d'environnement :\n   STATUS_GLOBAL_API_KEY=votre_clé_ici\n\nOu ajoutez dans votre config MCP :\n{\n  "mcpServers": {\n    "status-global": {\n      "command": "npx",\n      "args": ["@status-global/mcp-server"],\n      "env": {\n        "STATUS_GLOBAL_API_KEY": "votre_clé_ici"\n      }\n    }\n  }\n}`,
          },
        ],
      };
    }

    try {
      // Get server code
      if (!serverCode) {
        const servers = await getServers();
        if (!servers.length) throw new Error("Aucun serveur disponible");
        serverCode = servers[0].code;
      }

      // Create test
      const jobId = await createTest(url, serverCode);

      // Poll until done
      const job = await pollUntilDone(jobId);

      if (job.status === "error") {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ L'audit a échoué : ${job.error_message || "erreur inconnue"}\n\nURL : ${url}\nJob ID : ${jobId}`,
            },
          ],
        };
      }

      const report = job.report;
      if (!report) {
        return {
          content: [
            {
              type: "text" as const,
              text: `⚠️ L'audit est terminé mais le rapport est vide.\n\nJob ID : ${jobId}`,
            },
          ],
        };
      }

      const outputFormat = format || "prompt";
      const targetUrl = report.target?.url || url;
      let text: string;

      if (outputFormat === "full") {
        text = JSON.stringify(report, null, 2);
      } else if (outputFormat === "summary") {
        text = buildSummary(report, targetUrl);
      } else {
        text = buildPrompt(report, targetUrl);
      }

      text += `\n\n---\n_Rapport complet : ${API_BASE}/report/${jobId}_`;

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Erreur : ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: get existing report
server.tool(
  "get_report",
  "Récupère un rapport d'audit existant par son ID et retourne le prompt d'amélioration.",
  {
    job_id: z.string().describe("ID du job/rapport (ULID)"),
    format: z
      .enum(["prompt", "summary", "full"])
      .optional()
      .describe("Format de sortie : 'prompt' (défaut), 'summary', ou 'full'"),
  },
  async ({ job_id, format }) => {
    try {
      const job = await getJob(job_id);

      if (!job.ok) {
        return {
          content: [{ type: "text" as const, text: `❌ Rapport non trouvé : ${job_id}` }],
        };
      }

      if (job.status !== "done" || !job.report) {
        return {
          content: [
            {
              type: "text" as const,
              text: `⏳ Rapport pas encore prêt (statut: ${job.status}, progression: ${job.progress || 0}%)`,
            },
          ],
        };
      }

      const report = job.report;
      const targetUrl = report.target?.url || job.url || "";
      const outputFormat = format || "prompt";
      let text: string;

      if (outputFormat === "full") {
        text = JSON.stringify(report, null, 2);
      } else if (outputFormat === "summary") {
        text = buildSummary(report, targetUrl);
      } else {
        text = buildPrompt(report, targetUrl);
      }

      text += `\n\n---\n_Rapport complet : ${API_BASE}/report/${job_id}_`;

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Erreur : ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: list available servers
server.tool(
  "list_servers",
  "Liste les serveurs de test disponibles pour les audits.",
  {},
  async () => {
    try {
      const servers = await getServers();
      const text = servers.length
        ? servers.map((s) => `- **${s.code}** : ${s.name}`).join("\n")
        : "Aucun serveur disponible.";
      return {
        content: [{ type: "text" as const, text: `## Serveurs disponibles\n\n${text}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Erreur : ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
