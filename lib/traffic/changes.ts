"use client";

import { supabase } from "@/lib/supabase/client";

const LOCAL_CHANNEL = "travkinflow.traffic.changed.v1";
const LIVE_TOPIC_PREFIX = "travkinflow:traffic";
const LIVE_EVENT = "changed";
const COMPANY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ListenerEntry = { companyId: string; receive: (companyId: string) => void };
const listeners = new Set<ListenerEntry>();
let localChannel: BroadcastChannel | null = null;
type LiveChannel = ReturnType<typeof supabase.channel>;
type LiveState = { refs: number; generation: number; channel: LiveChannel | null; starting: boolean };
const liveStates = new Map<string, LiveState>();

function validCompanyId(value: unknown): value is string {
  return typeof value === "string" && COMPANY_ID.test(value);
}

function deliver(value: unknown) {
  const companyId = value && typeof value === "object" && "companyId" in value
    ? (value as { companyId?: unknown }).companyId
    : value;
  if (!validCompanyId(companyId)) return;
  listeners.forEach(entry => {
    if (entry.companyId !== companyId) return;
    try { entry.receive(companyId); } catch { /* Independent subscribers. */ }
  });
}

function liveTopic(companyId: string) {
  return `${LIVE_TOPIC_PREFIX}:${companyId}`;
}

async function startLiveChannel(companyId: string, state: LiveState) {
  if (state.starting || state.channel || state.refs < 1) return;
  state.starting = true;
  const generation = state.generation;
  try {
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token || liveStates.get(companyId) !== state ||
      state.generation !== generation || state.refs < 1) return;
    await supabase.realtime.setAuth(token);
    if (liveStates.get(companyId) !== state || state.generation !== generation || state.refs < 1) return;
    const next = supabase
      .channel(liveTopic(companyId), { config: { broadcast: { ack: false, self: false } } })
      // The topic chooses the tenant. Never trust or consume remote payload data.
      .on("broadcast", { event: LIVE_EVENT }, () => deliver(companyId));
    state.channel = next;
    next.subscribe();
  } catch {
    // The one-second canonical refresh and focus refresh remain available.
  } finally {
    state.starting = false;
  }
}

function retainLiveChannel(companyId: string) {
  const state = liveStates.get(companyId) ?? { refs: 0, generation: 0, channel: null, starting: false };
  state.refs++;
  liveStates.set(companyId, state);
  void startLiveChannel(companyId, state);
  return () => {
    const current = liveStates.get(companyId);
    if (!current) return;
    current.refs = Math.max(0, current.refs - 1);
    if (current.refs) return;
    current.generation++;
    liveStates.delete(companyId);
    if (current.channel) void supabase.removeChannel(current.channel);
    current.channel = null;
  };
}

async function sendLiveInvalidation(companyId: string) {
  try {
    const active = liveStates.get(companyId)?.channel;
    if (active) {
      await active.send({ type: "broadcast", event: LIVE_EVENT, payload: {} });
      return;
    }
    const { data, error } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (error || !token) return;
    await supabase.realtime.setAuth(token);
    // An unsubscribed Realtime channel sends Broadcast through its HTTP fallback,
    // so a just-opened manager page cannot lose the first committed change.
    const sender = supabase.channel(liveTopic(companyId), {
      config: { broadcast: { ack: true, self: false } },
    });
    try {
      await sender.send({ type: "broadcast", event: LIVE_EVENT, payload: {} });
    } finally {
      await supabase.removeChannel(sender);
    }
  } catch {
    // The mutation is already committed. Live delivery must never turn it into a false failure.
  }
}

/** Only an invalidation hint. Every receiver rereads its own authorized snapshot. */
export function subscribeTrafficChanges(
  companyId: string | undefined,
  listener: (companyId: string) => void,
): () => void {
  if (!validCompanyId(companyId)) return () => undefined;
  const entry = { companyId, receive: listener };
  listeners.add(entry);
  const releaseLive = retainLiveChannel(companyId);
  try {
    if (!localChannel && typeof BroadcastChannel !== "undefined") {
      localChannel = new BroadcastChannel(LOCAL_CHANNEL);
      localChannel.onmessage = event => deliver(event.data);
    }
  } catch { /* Normal background refresh remains available. */ }
  return () => {
    listeners.delete(entry);
    releaseLive();
    if (!listeners.size) { localChannel?.close(); localChannel = null; }
  };
}

/** Call only after a validated server commit, never for optimistic UI intent. */
export function publishTrafficChanged(companyId: string | undefined): void {
  if (!validCompanyId(companyId)) return;
  try {
    if (localChannel) localChannel.postMessage({ companyId });
    else if (typeof BroadcastChannel !== "undefined") {
      const sender = new BroadcastChannel(LOCAL_CHANNEL);
      sender.postMessage({ companyId });
      sender.close();
    }
  } catch { /* A delivered action must not become a false failure. */ }
  void sendLiveInvalidation(companyId);
}
