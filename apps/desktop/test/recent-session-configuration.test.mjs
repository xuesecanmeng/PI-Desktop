import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { useAppStore } = await import("../src/stores/app-store.ts");
const { api } = await import("../src/lib/api.ts");
const { createSessionRuntime } = await import("../src/stores/runtime/session-runtime.ts");
const { createSessionCoordination } = await import("../src/stores/runtime/session-coordination.ts");

const levels = ["off", "medium", "high", "max"];
const provider = { id: "p", enabled: true, authKind: "none", supportsReasoning: true, supportedThinkingLevels: levels,
  models: ["latest", "other"].map(id => ({ id, thinkingLevels: levels, defaultThinkingLevel: "medium" })) };
const session = (id, extra = {}) => ({ id, mode: "agent", title: "Existing conversation", providerId: "p", modelId: "other", thinkingLevel: "medium", messageCount: 0, ...extra });
function fixture(t, extra = {}) {
  let state = { sessions: [session("fixture")], providers: [provider], providerModels: {},
    recentModels: [{ providerId: "p", modelId: "latest", thinkingLevel: "high" }],
    pendingPlans: {}, runningSessions: {}, sessionMeta: {}, planningStates: {},
    showToast: t.mock.fn(), refreshSessions: async () => {}, ...extra };
  const access = { get: () => state, set: update => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; } };
  const runtime = createSessionRuntime(access);
  const coordination = createSessionCoordination({ ...access, runtime,
    decorateSessions: sessions => sessions, withoutRecordKey: (record, key) => {
      const next = { ...record }; delete next[key]; return next;
    }, untitledTaskTitle: () => "Untitled" });
  return { ...access, runtime, coordination };
}

test("a running session stages the latest combination until its current turn finishes", async t => {
  const f = fixture(t, { runningSessions: { fixture: true } });
  const writes = [];
  t.mock.method(api, "configureSession", async (id, config) => {
    writes.push({ id, ...config });
    return { session: { ...f.get().sessions[0], ...config } };
  });
  f.coordination.applyRecentSessionModel("fixture");
  assert.equal(f.get().sessions[0].modelId, "latest");
  assert.equal(f.get().sessions[0].thinkingLevel, "high");
  assert.deepEqual(writes, [], "switching must not reconfigure an in-flight runtime");
  f.set({ runningSessions: {} });
  await f.coordination.flushPendingSessionConfiguration("fixture");
  assert.deepEqual(writes, [{ id: "fixture", mode: "agent", providerId: "p", modelId: "latest", thinkingLevel: "high" }]);
});

test("remote, native and approval-owned sessions keep their configuration boundary", async t => {
  const f = fixture(t, { sessions: [session("remote:x", { source: "remote" }), session("native", { source: "pi-native" }),
    session("approval"), session("locked", { capabilities: { canConfigureModel: false } })],
    pendingPlans: { approval: { status: "pending" } } });
  const before = structuredClone(f.get().sessions);
  const writes = t.mock.method(api, "configureSession", async () => { throw new Error("unexpected write"); });
  for (const record of before) f.coordination.applyRecentSessionModel(record.id);
  assert.deepEqual(f.get().sessions, before);
  assert.equal(writes.mock.callCount(), 0);
});

test("legacy recent pairs do not reset an existing same-model thinking override", t => {
  const f = fixture(t, { sessions: [session("fixture", { modelId: "latest", thinkingLevel: "max" })],
    recentModels: [{ providerId: "p", modelId: "latest" }] });
  f.coordination.applyRecentSessionModel("fixture");
  assert.equal(f.get().sessions[0].thinkingLevel, "max");
  assert.equal(f.runtime.pendingSessionConfigurations.size, 0);
});

test("switch then send waits for configuration, preserves newer input and stays bound across navigation", async t => {
  const initial = useAppStore.getState();
  t.after(() => useAppStore.setState(initial));
  const sessions = [session("pref-from", { modelId: "latest", thinkingLevel: "high" }), session("pref-to"),
    session("pref-away", { modelId: "latest", thinkingLevel: "high" })];
  useAppStore.setState({ sessions, activeSessionId: "pref-from", providers: [provider], providerModels: {},
    recentModels: [{ providerId: "p", modelId: "latest", thinkingLevel: "high" }],
    settings: {}, workspace: null, activeProjectPath: null, messages: [], runningSessions: {}, isRunning: false,
    pendingPlans: {}, pendingPermissions: {}, pendingAsks: {}, retainedTranscripts: {}, retainedSessionIds: [], selectingSessionId: undefined });
  t.mock.method(api, "getSession", async id => ({ session: { ...useAppStore.getState().sessions.find(s => s.id === id), messages: [] } }));
  t.mock.method(api, "listSessions", async () => ({ sessions }));
  t.mock.method(api, "listProviders", async () => ({ providers: [provider] }));
  t.mock.method(api, "getSettings", async () => ({}));
  t.mock.method(api, "getOnboarding", async () => ({}));
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let releaseNewer;
  const newerBarrier = new Promise(resolve => { releaseNewer = resolve; });
  let newerStarted;
  const newerWrite = new Promise(resolve => { newerStarted = resolve; });
  const requests = [];
  t.mock.method(api, "configureSession", async (id, config) => {
    requests.push({ id, ...config });
    if (requests.length === 1) await barrier;
    else { newerStarted(); await newerBarrier; }
    return { session: { ...sessions.find(s => s.id === id), ...config } };
  });
  const prompts = [];
  t.mock.method(api, "prompt", async input => {
    const effective = useAppStore.getState().sessions.find(s => s.id === input.sessionId);
    prompts.push({ id: input.sessionId, modelId: effective.modelId, thinkingLevel: effective.thinkingLevel });
    return {};
  });
  await useAppStore.getState().selectSession("pref-to");
  assert.equal(useAppStore.getState().sessions.find(s => s.id === "pref-to").thinkingLevel, "high");
  await useAppStore.getState().configureActiveSession({ mode: "agent", providerId: "p", modelId: "other", thinkingLevel: "max" });
  const submission = useAppStore.getState().sendPrompt("send with the new selection");
  assert.deepEqual(prompts, [], "the prompt must wait for the pending configuration write");
  await useAppStore.getState().refreshSessions();
  assert.equal(useAppStore.getState().sessions.find(s => s.id === "pref-to").thinkingLevel, "max", "a durable list refresh must preserve queued next-turn input");
  await useAppStore.getState().refreshProviders();
  assert.equal(useAppStore.getState().sessions.find(s => s.id === "pref-to").thinkingLevel, "max", "a catalog refresh must preserve queued next-turn input");
  await useAppStore.getState().selectSession("pref-away");
  release();
  await newerWrite;
  assert.equal(useAppStore.getState().sessions.find(s => s.id === "pref-to").thinkingLevel, "max", "an older response must not revert the newer optimistic selection");
  releaseNewer();
  assert.equal(await submission, true);
  assert.equal(useAppStore.getState().activeSessionId, "pref-away");
  assert.deepEqual(requests.map(({ modelId, thinkingLevel }) => ({ modelId, thinkingLevel })), [
    { modelId: "latest", thinkingLevel: "high" }, { modelId: "other", thinkingLevel: "max" },
  ]);
  assert.deepEqual(prompts, [{ id: "pref-to", modelId: "other", thinkingLevel: "max" }]);
});

test("a failed inherited configuration blocks submission and keeps the pending choice recoverable", async t => {
  const initial = useAppStore.getState();
  t.after(() => useAppStore.setState(initial));
  const target = session("pref-failure");
  useAppStore.setState({ sessions: [target], activeSessionId: null, providers: [provider], providerModels: {},
    recentModels: [{ providerId: "p", modelId: "latest", thinkingLevel: "high" }],
    settings: {}, workspace: null, activeProjectPath: null, messages: [], runningSessions: {}, isRunning: false,
    pendingPlans: {}, retainedTranscripts: {}, retainedSessionIds: [], selectingSessionId: undefined });
  t.mock.method(api, "getSession", async () => ({ session: { ...target, messages: [] } }));
  t.mock.method(api, "listSessions", async () => ({ sessions: [target] }));
  const configure = t.mock.method(api, "configureSession", async () => { throw new Error("configuration unavailable"); });
  const prompts = t.mock.method(api, "prompt", async () => ({}));
  await useAppStore.getState().selectSession(target.id);
  assert.equal(await useAppStore.getState().sendPrompt("keep my draft"), false);
  assert.equal(prompts.mock.callCount(), 0);
  assert.equal(useAppStore.getState().sessions.find(s => s.id === target.id).thinkingLevel, "high");
  configure.mock.mockImplementation(async (id, config) => ({ session: { ...target, ...config, id } }));
  assert.equal(await useAppStore.getState().sendPrompt("retry my draft"), true);
});
