interface RestClientConfig {
  baseUrl: string;
  apiKey: string;
}

interface SessionMessage {
  role: "user" | "assistant";
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
}

export class EvalRestClient {
  private config: RestClientConfig;

  constructor(config: RestClientConfig) {
    this.config = config;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createSession(
    channelType: string,
    userIdentifier: string,
  ): Promise<{ id: string }> {
    const res = await fetch(`${this.config.baseUrl}/api/sessions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ channelType, userIdentifier }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }

  async closeSession(
    sessionId: string,
    status: "completed" | "abandoned",
  ): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/api/sessions/${sessionId}`,
      {
        method: "PATCH",
        headers: this.headers,
        body: JSON.stringify({ status }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to close session (${res.status}): ${text}`);
    }
  }

  async addMessages(
    sessionId: string,
    messages: SessionMessage[],
  ): Promise<void> {
    for (const message of messages) {
      const res = await fetch(
        `${this.config.baseUrl}/api/sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(message),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to add message (${res.status}): ${text}`);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/health`, {
        headers: this.headers,
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
