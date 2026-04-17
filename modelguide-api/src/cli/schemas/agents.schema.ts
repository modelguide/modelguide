import { z } from "zod";
import { secretTypes } from "./secrets.schema";

const modalities = ["voice", "text"] as const;
const agentPlatforms = ["custom", "elevenlabs", "livekit"] as const;

const agentSecretSchema = z.object({
  field: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(secretTypes),
  value: z.string().optional(), // populated interactively or via --skip-secrets
});

const livekitConfigSchema = z.object({
  url: z.string().min(1),
  agentName: z.string().min(1),
});

const elevenlabsConfigSchema = z.object({
  llmModel: z.string().min(1),
});

const agentToolLinkSchema = z.object({
  connectorSlug: z.string().min(1),
  toolSlugs: z.array(z.string()).optional(), // omit = all tools
});

export const agentItemSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    modality: z.enum(modalities).default("voice"),
    platform: z.enum(agentPlatforms).default("custom"),
    active: z.boolean().default(false),
    compiledPrompt: z.string().min(1).optional(),
    tools: z.array(agentToolLinkSchema).default([]),
    config: z.union([livekitConfigSchema, elevenlabsConfigSchema]).optional(),
    secrets: z.array(agentSecretSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "livekit") {
      if (!data.config) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'config is required when platform is "livekit"',
          path: ["config"],
        });
      } else {
        // Validate config matches livekit shape (url + agentName required)
        const result = livekitConfigSchema.safeParse(data.config);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'config must have url and agentName when platform is "livekit"',
            path: ["config"],
          });
        }
      }
    }
    if (data.platform === "elevenlabs") {
      if (!data.config) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'config.llmModel is required when platform is "elevenlabs"',
          path: ["config"],
        });
      } else {
        // Validate config matches elevenlabs shape (llmModel required)
        const result = elevenlabsConfigSchema.safeParse(data.config);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'config must have llmModel when platform is "elevenlabs"',
            path: ["config"],
          });
        }
      }
    }
  });

export const agentsFileSchema = z.object({
  agents: z.array(agentItemSchema).min(1),
});

export type AgentItemInput = z.infer<typeof agentItemSchema>;
