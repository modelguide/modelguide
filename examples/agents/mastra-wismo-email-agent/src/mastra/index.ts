import { Mastra } from "@mastra/core";
import { wismoAgent } from "./agents/wismo.js";

export const mastra = new Mastra({
  agents: { wismoAgent },
});
