import { z } from "zod";

const modalities = ["voice", "text"] as const;
const agentPlatforms = ["custom", "elevenlabs"] as const;

const agentToolLinkSchema = z.object({
  connectorSlug: z.string().min(1),
  toolSlugs: z.array(z.string()).optional(), // omit = all tools
});

export const agentItemSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  modality: z.enum(modalities).default("voice"),
  platform: z.enum(agentPlatforms).default("custom"),
  tools: z.array(agentToolLinkSchema).default([]),
});

export const agentsFileSchema = z.object({
  agents: z.array(agentItemSchema).min(1),
});

export type AgentItemInput = z.infer<typeof agentItemSchema>;
