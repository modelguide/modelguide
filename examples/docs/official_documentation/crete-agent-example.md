import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import "dotenv/config";

const elevenlabs = new ElevenLabsClient();

const agent = await elevenlabs.conversationalAi.agents.create({
  name: "My conversational agent",
  conversationConfig: {
    agent: {
      prompt: {
        prompt: "You are a helpful assistant that can answer questions and help with tasks.",
      }
    },
  },
});