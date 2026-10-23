import assert from "node:assert/strict";
import test from "node:test";
import {
  inheritedSessionModelBinding,
  inheritedSessionThinkingLevel,
  lastUsedSessionModel,
  pinnedSessionModelBinding,
  sessionNeedsModelPin,
} from "../src/lib/session-model.ts";

const providers = [
  {
    id: "openai",
    defaultModelId: "gpt-4.1",
    models: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
  },
  {
    id: "anthropic",
    defaultModelId: "claude-sonnet",
    models: [{ id: "claude-sonnet" }],
  },
];

test("remembered thinking wins over a binding default and clamps to enabled levels", () => {
  const provider = { id: "p", models: [{ id: "model", thinkingLevels: ["medium", "high"], defaultThinkingLevel: "medium" }] };
  const options = { selection: { providerId: "p", modelId: "model" }, providers: [provider],
    providerModels: { p: [{ modelId: "model", catalogSource: "models.dev" }] } };
  assert.equal(inheritedSessionThinkingLevel(options), "medium");
  assert.equal(inheritedSessionThinkingLevel({ ...options, recentModels: [{ providerId: "p", modelId: "MODEL", thinkingLevel: "high" }] }), "high");
  assert.equal(inheritedSessionThinkingLevel({ ...options, recentModels: [{ providerId: "p", modelId: "model", thinkingLevel: "max" }] }), "high");
  assert.equal(inheritedSessionThinkingLevel({ ...options, recentModels: [{ providerId: "other", modelId: "model", thinkingLevel: "high" }] }), "medium");
  assert.equal(inheritedSessionThinkingLevel({ ...options, recentModels: [{ providerId: "p", modelId: "model", thinkingLevel: "high" }], thinkingLevel: "medium" }), "medium");
  assert.equal(inheritedSessionThinkingLevel({ ...options, providerModels: {}, recentModels: [{ providerId: "p", modelId: "model", thinkingLevel: "omit" }] }), "omit");
  assert.equal(inheritedSessionThinkingLevel({ ...options, providerModels: {}, providers: [{ ...provider, models: [{ id: "model", thinkingLevels: [] }] }], recentModels: [{ providerId: "p", modelId: "model", thinkingLevel: "max" }] }), "max");
  assert.equal(inheritedSessionThinkingLevel({ ...options, providers: [{ ...provider, models: [{ id: "model", thinkingLevels: ["off"] }] }], recentModels: [{ providerId: "p", modelId: "model", thinkingLevel: "high" }] }), "off");
});

test("new sessions snapshot the app default provider and model", () => {
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: null,
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
});

test("an explicit composer draft wins over the app default", () => {
  assert.deepEqual(
    inheritedSessionModelBinding({
      draft: { providerId: "anthropic", modelId: "claude-sonnet" },
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
});

test("changing the app default later does not rewrite a pinned session", () => {
  const created = inheritedSessionModelBinding({
    draft: null,
    settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1" },
    providers,
  });
  const laterDefault = inheritedSessionModelBinding({
    draft: null,
    settings: { defaultProviderId: "anthropic", defaultModelId: "claude-sonnet" },
    providers,
  });
  assert.deepEqual(created, { providerId: "openai", modelId: "gpt-4.1" });
  assert.deepEqual(laterDefault, { providerId: "anthropic", modelId: "claude-sonnet" });
  assert.notDeepEqual(created, laterDefault);
});

test("unpinned desktop sessions need a durable model pin", () => {
  assert.equal(sessionNeedsModelPin({}), true);
  assert.equal(sessionNeedsModelPin({ providerId: "openai" }), true);
  assert.equal(sessionNeedsModelPin({ modelId: "gpt-4.1" }), true);
  assert.equal(
    sessionNeedsModelPin({ providerId: "openai", modelId: "gpt-4.1" }),
    false,
  );
  assert.equal(
    sessionNeedsModelPin({ source: "pi-native", providerId: "openai" }),
    false,
  );
  assert.equal(
    sessionNeedsModelPin({ source: "remote", modelId: "gpt-4.1" }),
    false,
  );
});

test("legacy unpinned sessions pin the last used turn before the live default", () => {
  assert.deepEqual(
    lastUsedSessionModel([
      { providerId: "openai", modelId: "gpt-4.1" },
      { providerId: "anthropic", modelId: "claude-sonnet" },
    ]),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    pinnedSessionModelBinding({
      session: {},
      messages: [{ providerId: "anthropic", modelId: "claude-sonnet" }],
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "anthropic", modelId: "claude-sonnet" },
  );
  assert.deepEqual(
    pinnedSessionModelBinding({
      session: {},
      messages: [],
      settings: { defaultProviderId: "openai", defaultModelId: "gpt-4.1-mini" },
      providers,
    }),
    { providerId: "openai", modelId: "gpt-4.1-mini" },
  );
});
