/**
 * Zod schema for personas.yaml import file.
 *
 * Example file:
 *
 * personas:
 *   - id: bank-nowa-customer
 *     name: Bank Nowa Customer
 *     description: "A cooperative Polish banking customer"
 *     system_prompt: |
 *       Jesteś polskim klientem banku Bank Nowa S.A. ...
 *     traits: [cooperative, polish-speaking, banking]
 *     max_turns: 20
 *     email: jan.nowak@banknowa.pl
 */

import { z } from "zod";

export const personaItemSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  system_prompt: z.string().min(1),
  traits: z.array(z.string()).default([]),
  max_turns: z.number().int().positive().optional(),
  email: z.string().email().optional(),
});

export const personasFileSchema = z.object({
  personas: z.array(personaItemSchema).min(1),
});

export type PersonaItemInput = z.infer<typeof personaItemSchema>;
