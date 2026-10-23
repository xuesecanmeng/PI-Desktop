import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { useAppStore } = await import("../src/stores/app-store.ts");
const { api } = await import("../src/lib/api.ts");

const levels = ["off", "medium", "high", "max"];
const provider = { id: "p", enabled: true, authKind: "none", supportsReasoning: true, supportedThinkingLevels: levels,
  models: ["latest", "other"].map(id => ({ id, thinkingLevels: levels, defaultThinkingLevel: "medium" })) };
let nextFixture = 0;
function fixture(t, targetConfig = {}) {
  const initial = useAppStore.getState();
  const previousStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  t.after(() => { useAppStore.setState(initial); globalThis.localStorage = previousStorage; });
  const prefix = `recent-config-${++nextFixture}`;
  const session = (id, modelId, thinkingLevel) => ({ id, title: "Existing conversation", mode: "agent", providerId: "p", modelId, thinkingLevel, messageCount: 1 });
  const from = session(`${prefix}-from`, "latest", "high");
  const target = { ...session(`${prefix}-to`, "other", "medium"), ...targetConfig };
  const durable = new Map([from, target].map(record => [record.id, { ...record }]));
  const history = new Map([from, target].map(record => [record.id, [{ id: `${record.id}-answer`, role: "assistant",
    content: "Existing answer", createdAt: "2026-10-23T00:00:00.000Z", status: "complete", providerId: "p", modelId: record.modelId }]]));
  useAppStore.setState({ sessions: [...durable.values()], activeSessionId: from.id, providers: [provider], providerModels: {},
    recentModels: [{ providerId: "p", modelId: "other", thinkingLevel: "medium" }],
    settings: {}, workspace: null, activeProjectPath: null, messages: history.get(from.id), runningSessions: {}, isRunning: false,
    pendingPlans: {}, pendingPermissions: {}, pendingAsks: {}, retainedTranscripts: {}, retainedSessionIds: [], selectingSessionId: undefined });
  t.mock.method(api, "getSession", async id => ({ session: { ...durable.get(id), messages: history.get(id) } }));
  t.mock.method(api, "listSessions", async () => ({ sessions: [...durable.values()] }));
  t.mock.method(api, "listProviders", async () => ({ providers: [provider] }));
  t.mock.method(api, "getSettings", async () => ({}));
  t.mock.method(api, "getOnboarding", async () => ({}));
  const writes = [];
  const persist = (id, config) => {
    const session = { ...durable.get(id), ...config };
    durable.set(id, session);
    return { session };
  };
  const configure = t.mock.method(api, "configureSession", async (id, config) => {
    writes.push({ id, ...config });
    return persist(id, config);
  });
  const prompts = [];
  t.mock.method(api, "prompt", async ({ sessionId }) => {
    const session = durable.get(sessionId);
    prompts.push({ id: sessionId, modelId: session.modelId, thinkingLevel: session.thinkingLevel });
    return {};
  });
  return { from, target, durable, writes, persist, configure, prompts, current: () => useAppStore.getState().sessions.find(record => record.id === target.id) };
}

for (const [name, target] of [["different model", {}], ["same model with its own thinking level", { modelId: "latest", thinkingLevel: "max" }]]) {
  test(`switching existing chats preserves ${name} after accepted usage elsewhere`, async t => {
    const f = fixture(t, target);
    assert.equal(await useAppStore.getState().sendPrompt("use the model in A"), true);
    assert.deepEqual(useAppStore.getState().recentModels[0], { providerId: "p", modelId: "latest", thinkingLevel: "high" });
    useAppStore.setState({ runningSessions: {}, isRunning: false });
    await useAppStore.getState().selectSession(f.target.id);
    assert.equal(useAppStore.getState().activeSessionId, f.target.id);
    assert.equal(f.current().modelId, f.target.modelId);
    assert.equal(f.current().thinkingLevel, f.target.thinkingLevel);
    await useAppStore.getState().selectSession(f.from.id);
    await useAppStore.getState().selectSession(f.target.id, { record: false });
    assert.equal(f.current().modelId, f.target.modelId, "cached navigation keeps the target binding");
    assert.equal(f.current().thinkingLevel, f.target.thinkingLevel);
    assert.deepEqual(f.writes, [], "navigation must not write another chat's configuration");
    assert.deepEqual(f.durable.get(f.target.id), f.target);
    assert.equal(await useAppStore.getState().sendPrompt("continue B with its own selection"), true);
    assert.deepEqual(f.prompts.at(-1), { id: f.target.id, modelId: f.target.modelId, thinkingLevel: f.target.thinkingLevel });
  });
}

test("opening a running chat does not stage the last used model for its next turn", async t => {
  const f = fixture(t);
  useAppStore.setState({ recentModels: [{ providerId: "p", modelId: "latest", thinkingLevel: "high" }], runningSessions: { [f.target.id]: true } });
  await useAppStore.getState().selectSession(f.target.id);
  assert.equal(f.current().modelId, "other");
  assert.equal(f.current().thinkingLevel, "medium");
  useAppStore.setState({ runningSessions: {}, isRunning: false });
  assert.equal(await useAppStore.getState().sendPrompt("next B turn"), true);
  assert.deepEqual(f.writes, [], "ending the turn must not reveal an inherited configuration queued by navigation");
  assert.deepEqual(f.prompts, [{ id: f.target.id, modelId: "other", thinkingLevel: "medium" }]);
});

test("creating a new chat inherits accepted usage without changing existing chats", async t => {
  const f = fixture(t);
  assert.equal(await useAppStore.getState().sendPrompt("use latest at high"), true);
  useAppStore.setState({ runningSessions: {}, isRunning: false });
  const createdId = `${f.from.id}-new`;
  t.mock.method(api, "createSession", async config => ({ session: {
    ...config, id: createdId, title: "New conversation", messageCount: 0, messages: [],
  } }));
  await useAppStore.getState().newSession();
  const created = useAppStore.getState().sessions.find(record => record.id === createdId);
  assert.equal(useAppStore.getState().activeSessionId, createdId);
  assert.equal(created.providerId, "p");
  assert.equal(created.modelId, "latest");
  assert.equal(created.thinkingLevel, "high", "new chats retain usage instead of the medium binding default");
  assert.equal(f.current().modelId, "other");
  assert.equal(f.current().thinkingLevel, "medium");
  assert.deepEqual(f.writes, []);
});

test("explicit next-turn changes survive navigation, older responses and catalog refreshes", async t => {
  const f = fixture(t);
  useAppStore.setState({ runningSessions: { [f.target.id]: true } });
  await useAppStore.getState().selectSession(f.target.id);
  await useAppStore.getState().configureActiveSession({ mode: "agent", providerId: "p", modelId: "latest", thinkingLevel: "high" });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let releaseNewer;
  const newerBarrier = new Promise(resolve => { releaseNewer = resolve; });
  let firstStarted;
  const firstWrite = new Promise(resolve => { firstStarted = resolve; });
  let newerStarted;
  const newerWrite = new Promise(resolve => { newerStarted = resolve; });
  f.configure.mock.mockImplementation(async (id, config) => {
    f.writes.push({ id, ...config });
    if (f.writes.length === 1) { firstStarted(); await barrier; }
    else { newerStarted(); await newerBarrier; }
    return f.persist(id, config);
  });
  useAppStore.setState({ runningSessions: {}, isRunning: false });
  const submission = useAppStore.getState().sendPrompt("wait for my explicit selection");
  await firstWrite;
  await useAppStore.getState().configureActiveSession({ mode: "agent", providerId: "p", modelId: "other", thinkingLevel: "max" });
  assert.deepEqual(f.prompts, []);
  await useAppStore.getState().refreshSessions();
  assert.equal(f.current().thinkingLevel, "max");
  await useAppStore.getState().refreshProviders();
  assert.equal(f.current().thinkingLevel, "max");
  await useAppStore.getState().selectSession(f.from.id);
  release();
  await newerWrite;
  assert.equal(f.current().thinkingLevel, "max", "an older response cannot revert newer explicit input");
  releaseNewer();
  assert.equal(await submission, true);
  assert.equal(useAppStore.getState().activeSessionId, f.from.id);
  assert.deepEqual(f.writes, [
    { id: f.target.id, mode: "agent", providerId: "p", modelId: "latest", thinkingLevel: "high" },
    { id: f.target.id, mode: "agent", providerId: "p", modelId: "other", thinkingLevel: "max" },
  ]);
  assert.deepEqual(f.prompts, [{ id: f.target.id, modelId: "other", thinkingLevel: "max" }]);
});

test("a failed explicit next-turn configuration blocks submission until retry", async t => {
  const f = fixture(t);
  useAppStore.setState({ runningSessions: { [f.target.id]: true } });
  await useAppStore.getState().selectSession(f.target.id);
  await useAppStore.getState().configureActiveSession({ mode: "agent", providerId: "p", modelId: "latest", thinkingLevel: "high" });
  useAppStore.setState({ runningSessions: {}, isRunning: false });
  f.configure.mock.mockImplementation(async () => { throw new Error("configuration unavailable"); });
  assert.equal(await useAppStore.getState().sendPrompt("keep my draft"), false);
  assert.deepEqual(f.prompts, []);
  assert.equal(f.current().modelId, "latest");
  assert.equal(f.current().thinkingLevel, "high");
  f.configure.mock.mockImplementation(f.persist);
  assert.equal(await useAppStore.getState().sendPrompt("retry my draft"), true);
  assert.deepEqual(f.prompts, [{ id: f.target.id, modelId: "latest", thinkingLevel: "high" }]);
});
