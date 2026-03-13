#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const API_BASE = process.env.STATUS_GLOBAL_URL || "https://status.dragnoc.fr";

const CONFIG_DIR = join(homedir(), ".config", "status-global");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes max

// ── Config persistence ──

function loadConfig(): { apiKey?: string } {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(config: { apiKey?: string }): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function getApiKey(): string {
  // Env var takes priority, then config file
  return process.env.STATUS_GLOBAL_API_KEY || loadConfig().apiKey || "";
}

// ── Types ──

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
  is_premium?: boolean;
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

// ── API helpers ──

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function createTest(url: string): Promise<string> {
  const data = await apiRequest<{ ok: boolean; job_id?: string; error?: string; upgrade_url?: string }>(
    "/api/test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }
  );

  if (!data.ok || !data.job_id) {
    if (data.upgrade_url) {
      throw new Error(`${data.error}\n→ ${data.upgrade_url}`);
    }
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

// ── No API key response ──

function noApiKeyResponse() {
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Clé API non configurée.`,
          ``,
          `## Configuration en 2 étapes`,
          ``,
          `### 1. Obtenez votre clé API`,
          `Créez un compte sur ${API_BASE} puis allez dans **Mon Compte → Clé API → Générer**.`,
          ``,
          `### 2. Configurez la clé`,
          `Dites-moi simplement : **"Configure status-global avec la clé xxxxx"**`,
          ``,
          `Ou manuellement :`,
          `\`\`\`bash`,
          `claude mcp remove status-global`,
          `claude mcp add status-global -e STATUS_GLOBAL_API_KEY=VOTRE_CLE -- npx status-global-mcp`,
          `\`\`\``,
        ].join("\n"),
      },
    ],
  };
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
  lines.push(`# Généré par Status Global (${API_BASE})`);
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

function buildSummary(report: Report, targetUrl: string, isPremium: boolean = false): string {
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

  if (!isPremium) {
    summary += `\n---\n\n`;
    summary += `**Offre Premium** : obtenez le prompt de correction automatique pour Claude / Codex / GPT. `;
    summary += `Tests et corrections illimités. `;
    summary += `Souscrire : ${API_BASE}/pricing\n`;
  }

  return summary;
}

// ── MCP Server ──

const server = new McpServer({
  name: "status-global",
  version: "1.2.3",
});

// Tool: configure API key
server.tool(
  "configure",
  "Configure la clé API Status Global. La clé est sauvegardée dans ~/.config/status-global/config.json et utilisée pour tous les audits.",
  {
    api_key: z.string().describe("Votre clé API Status Global (depuis Mon Compte → Clé API)"),
  },
  async ({ api_key }) => {
    const trimmed = api_key.trim();
    if (!trimmed || trimmed.length < 16) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Clé API invalide. Générez-en une sur ${API_BASE}/app/account`,
          },
        ],
      };
    }

    saveConfig({ apiKey: trimmed });

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Clé API configurée et sauvegardée.`,
            ``,
            `Vous pouvez maintenant lancer un audit :`,
            `**"Audite mon site https://example.com et corrige les problèmes"**`,
          ].join("\n"),
        },
      ],
    };
  }
);

// Tool: audit a website
server.tool(
  "audit_website",
  "Lance un audit complet d'un site web (performance, sécurité, SEO, DNS) via Status Global et retourne un prompt structuré pour corriger les problèmes détectés.",
  {
    url: z.string().describe("URL du site web à auditer (ex: https://example.com)"),
    format: z
      .enum(["prompt", "summary", "full"])
      .optional()
      .describe("Format de sortie : 'prompt' (défaut) = prompt IA structuré, 'summary' = résumé concis, 'full' = rapport JSON complet"),
  },
  async ({ url, format }) => {
    if (!getApiKey()) {
      return noApiKeyResponse();
    }

    try {
      const jobId = await createTest(url);
      const job = await pollUntilDone(jobId);

      if (job.status === "error") {
        return {
          content: [
            {
              type: "text" as const,
              text: `L'audit a échoué : ${job.error_message || "erreur inconnue"}\n\nURL : ${url}\nJob ID : ${jobId}`,
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
              text: `L'audit est terminé mais le rapport est vide.\n\nJob ID : ${jobId}`,
            },
          ],
        };
      }

      const isPremium = job.is_premium === true;
      const outputFormat = format || "prompt";
      const targetUrl = report.target?.url || url;
      let text: string;

      if (outputFormat === "full") {
        text = JSON.stringify(report, null, 2);
      } else if (isPremium) {
        // Premium users always get the full prompt (they paid for it)
        text = buildPrompt(report, targetUrl);
      } else {
        text = buildSummary(report, targetUrl, false);
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
            text: `Erreur : ${error instanceof Error ? error.message : String(error)}`,
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
    if (!getApiKey()) {
      return noApiKeyResponse();
    }

    try {
      const job = await getJob(job_id);

      if (!job.ok) {
        return {
          content: [{ type: "text" as const, text: `Rapport non trouvé : ${job_id}` }],
        };
      }

      if (job.status !== "done" || !job.report) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Rapport pas encore prêt (statut: ${job.status}, progression: ${job.progress || 0}%)`,
            },
          ],
        };
      }

      const report = job.report;
      const isPremium = job.is_premium === true;
      const targetUrl = report.target?.url || job.url || "";
      const outputFormat = format || "prompt";
      let text: string;

      if (outputFormat === "full") {
        text = JSON.stringify(report, null, 2);
      } else if (isPremium) {
        text = buildPrompt(report, targetUrl);
      } else {
        text = buildSummary(report, targetUrl, false);
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
            text: `Erreur : ${error instanceof Error ? error.message : String(error)}`,
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

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("[status-global] Clé API non configurée. Dites \"configure status-global avec la clé xxx\" ou allez sur " + API_BASE + "/app/account");
  } else {
    console.error("[status-global] Connecté. Clé API configurée.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
