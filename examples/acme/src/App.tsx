import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

const LS_KEY = "acme-corp-config";

function loadConfig(): { apiKey: string; agentId: string } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { apiKey: parsed.apiKey ?? "", agentId: parsed.agentId ?? "" };
    }
  } catch {}
  return { apiKey: "", agentId: "" };
}

type Message = { source: "user" | "ai"; text: string; ts: number };

export function App() {
  const saved = useRef(loadConfig());
  const [apiKey, setApiKey] = useState(saved.current.apiKey);
  const [agentId, setAgentId] = useState(saved.current.agentId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [callDuration, setCallDuration] = useState(0);
  const callStart = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({ apiKey, agentId }));
  }, [apiKey, agentId]);

  const conversation = useConversation({
    onMessage: (props: { message: string; source: "user" | "ai" }) => {
      setMessages((prev) => [...prev, { source: props.source, text: props.message, ts: Date.now() }]);
    },
    onError: (err: string) => setError(err),
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const startCall = useCallback(async () => {
    setError(null);
    setMessages([]);
    setStarting(true);
    setCallDuration(0);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          channelType: "voice",
          userIdentifier: "demo-user",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Session creation failed (${res.status}): ${body}`);
      }

      const session = await res.json();
      setSessionId(session.id);

      await navigator.mediaDevices.getUserMedia({ audio: true });

      await conversation.startSession({
        agentId,
        dynamicVariables: {
          mg_session_id: session.id,
          mg_user_id: "demo-user",
        },
      });

      callStart.current = Date.now();
      timerRef.current = setInterval(() => {
        if (callStart.current) {
          setCallDuration(Math.floor((Date.now() - callStart.current) / 1000));
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [apiKey, agentId, conversation]);

  const endCall = useCallback(async () => {
    clearInterval(timerRef.current);
    callStart.current = null;
    await conversation.endSession();
  }, [conversation]);

  const isConnected = conversation.status === "connected";
  const isConnecting = conversation.status === "connecting" || starting;
  const isIdle = conversation.status === "disconnected" && !starting;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-50 text-zinc-900">
      {/* Top header */}
      <header className="shrink-0 border-b border-zinc-200 bg-white px-6 py-5 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <AcmeLogo />
          <div className="text-lg font-bold text-zinc-900 tracking-tight">
            Acme Corp — AI Voice Assistant
          </div>
        </div>
        <div className="text-[13px] text-zinc-500">
          Scenario 1: Voice support via browser
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span>Powered by</span>
          <ModelGuideLogo />
          <span className="text-zinc-300">&times;</span>
          <ElevenLabsLogo />
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left pane */}
        <div className="w-[340px] min-w-[340px] border-r border-zinc-200 bg-white p-6 flex flex-col gap-5 overflow-y-auto">
          {/* Config */}
          <div className="flex flex-col gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Configuration
            </div>
            <Field label="ModelGuide API Key">
              <input
                type="password"
                placeholder="mgk_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input-field"
                disabled={isConnected || isConnecting}
              />
            </Field>
            <Field label="ElevenLabs Agent ID">
              <input
                type="text"
                placeholder="agent_..."
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="input-field"
                disabled={isConnected || isConnecting}
              />
            </Field>
          </div>

          {/* Call button */}
          <div>
            {!isConnected ? (
              <button
                onClick={startCall}
                disabled={!apiKey || !agentId || isConnecting}
                className="w-full py-2.5 px-5 rounded-lg border-none text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-br from-brand to-brand-dark text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                <PhoneIcon />
                {isConnecting ? "Connecting..." : "Start Call"}
              </button>
            ) : (
              <button
                onClick={endCall}
                className="w-full py-2.5 px-5 rounded-lg border-none text-sm font-semibold flex items-center justify-center gap-2 bg-red-600 text-white cursor-pointer shadow-sm"
              >
                <StopIcon />
                End Call
              </button>
            )}
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full shrink-0"
                style={{
                  background: isConnected ? "#10b981" : isConnecting ? "#eab308" : "#a1a1aa",
                  boxShadow: isConnected
                    ? "0 0 8px #10b98144"
                    : isConnecting
                      ? "0 0 8px #eab30844"
                      : "none",
                }}
              />
              <span className="text-[13px] text-zinc-500">
                {isConnecting ? "Connecting..." : isConnected ? "Connected" : "Disconnected"}
              </span>
              {isConnected && (
                <span className="ml-auto text-[13px] font-mono text-zinc-400">
                  {fmtTime(callDuration)}
                </span>
              )}
            </div>

            {conversation.isSpeaking && (
              <div className="flex items-center gap-2 text-[13px] text-emerald-600 pl-4">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                Agent speaking
              </div>
            )}
          </div>

          {/* Session ID */}
          {sessionId && (
            <div className="text-xs text-zinc-400 break-all">
              Session: <code className="font-mono text-zinc-500">{sessionId}</code>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px]">
              {error}
            </div>
          )}

          {/* Post-call */}
          {isIdle && sessionId && messages.length > 0 && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[13px]">
              Call ended — transcript stored in session{" "}
              <code className="font-mono text-blue-600">{sessionId}</code>
            </div>
          )}
        </div>

        {/* Right pane — transcript */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-3 border-b border-zinc-200 bg-white flex items-center justify-between shrink-0">
            <span className="text-sm font-semibold text-zinc-700">Live Transcript</span>
            {messages.length > 0 && (
              <span className="text-[11px] text-zinc-400 bg-zinc-100 px-2.5 py-0.5 rounded-full">
                {messages.length} messages
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto scroll-smooth px-6 py-4 flex flex-col gap-0.5">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                <ChatIcon />
                <div className="text-[15px] font-semibold text-zinc-300">No messages yet</div>
                <div className="text-[13px] text-zinc-400 max-w-60 leading-relaxed">
                  Start a call to see the live transcript appear here
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className="flex gap-3 py-2.5">
                  <div
                    className="size-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5"
                    style={{ background: msg.source === "ai" ? "#7c3aed" : "#0891b2" }}
                  >
                    {msg.source === "ai" ? "A" : "U"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px] font-semibold text-zinc-700">
                        {msg.source === "ai" ? "Agent" : "Customer"}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {new Date(msg.ts).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-sm leading-relaxed text-zinc-600">{msg.text}</div>
                  </div>
                </div>
              ))
            )}
            <div ref={scrollRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Icons & helpers ──────────────────────────── */

function AcmeLogo() {
  return (
    <div className="size-10 rounded-xl bg-zinc-900 flex items-center justify-center shrink-0">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 19h20L12 2z" fill="#f97316" />
        <path d="M12 8l-5 9h10l-5-9z" fill="#fff" />
        <rect x="10.5" y="13" width="3" height="3" rx="0.5" fill="#f97316" />
      </svg>
    </div>
  );
}

function ModelGuideLogo() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-zinc-700 text-[12px]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
      ModelGuide
    </span>
  );
}

function ElevenLabsLogo() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-zinc-700 text-[12px]">
      <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
        <rect x="11" y="4" width="4" height="24" rx="1" fill="#4f46e5" />
        <rect x="18" y="4" width="4" height="24" rx="1" fill="#4f46e5" />
      </svg>
      ElevenLabs
    </span>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-200">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
