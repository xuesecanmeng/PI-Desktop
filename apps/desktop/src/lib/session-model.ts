/** Resolve configured and inherited next-turn model preferences. */
import type { RecentModel } from "./recent-models";
import {
  initialThinkingLevelForBinding,
  initialThinkingLevelForUnmatchedModel,
  type ModelInfo,
  type ProviderPublic,
  type SessionThinkingLevel,
} from "@pi-desktop/shared";

export type SessionModelRef = {
  providerId?: string;
  modelId?: string;
};

export type SessionModelProvider = {
  id: string;
  defaultModelId?: string;
  models?: Array<{ id: string }>;
  enabled?: boolean;
  hasSecret?: boolean;
  authKind?: string;
};

export type SessionModelSettings = {
  defaultProviderId?: string;
  defaultModelId?: string;
  imageGeneration?: SessionModelRef | null;
  imageGenerationModels?: SessionModelRef[] | null;
};

/** Only configured, runnable chat bindings can be inherited by a new chat. */
export function availableRecentModels(
  recentModels: readonly RecentModel[],
  providers: readonly SessionModelProvider[],
  settings?: SessionModelSettings | null,
): RecentModel[] {
  const images = [
    ...(settings?.imageGenerationModels ?? []),
    ...(settings?.imageGeneration ? [settings.imageGeneration] : []),
  ];
  return recentModels.filter(entry => {
    const provider = providers.find(item => item.id === entry.providerId);
    const ids = provider?.models?.length ? provider.models.map(model => model.id) : [provider?.defaultModelId];
    return provider && provider.enabled !== false &&
      (provider.authKind === undefined || provider.authKind === "none" || provider.hasSecret) &&
      ids.some(id => id?.toLowerCase() === entry.modelId.toLowerCase()) &&
      !images.some(image => image.providerId === entry.providerId && image.modelId?.toLowerCase() === entry.modelId.toLowerCase());
  });
}

/**
 * Snapshot the most recent available binding when a chat is created.
 * Explicit draft/session fields take priority over renderer-local recent usage.
 */
export function inheritedSessionModelBinding({
  draft,
  settings,
  providers,
  recentModels = [],
}: {
  draft?: SessionModelRef | null;
  settings?: SessionModelSettings | null;
  providers: readonly SessionModelProvider[];
  recentModels?: readonly RecentModel[];
}): SessionModelRef {
  if (draft?.providerId && draft.modelId) {
    return { providerId: draft.providerId, modelId: draft.modelId };
  }
  const fallbackCandidates = providers.flatMap(provider =>
    (provider.models?.length ? provider.models.map(model => model.id) : [provider.defaultModelId])
      .filter((modelId): modelId is string => !!modelId)
      .map(modelId => ({ providerId: provider.id, modelId })),
  );
  const legacy = settings?.defaultProviderId && settings.defaultModelId
    ? [{ providerId: settings.defaultProviderId, modelId: settings.defaultModelId }]
    : [];
  const inherited = [...recentModels, ...legacy, ...fallbackCandidates].find(entry =>
    availableRecentModels([entry], providers, settings).length > 0,
  );
  const providerId = draft?.providerId ?? inherited?.providerId;
  const provider = providers.find((item) => item.id === providerId);
  const modelId =
    draft?.modelId ??
    (providerId === inherited?.providerId ? inherited?.modelId : undefined) ??
    provider?.defaultModelId ??
    provider?.models?.[0]?.id;
  return {
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

/** Resolve one next-turn level for home, creation and session activation. */
export function inheritedSessionThinkingLevel({
  selection, providers, providerModels, recentModels = [], thinkingLevel,
}: {
  selection: SessionModelRef;
  providers: readonly ProviderPublic[];
  providerModels: Readonly<Record<string, readonly ModelInfo[] | undefined>>;
  recentModels?: readonly RecentModel[];
  thinkingLevel?: SessionThinkingLevel;
}): SessionThinkingLevel {
  const provider = providers.find((candidate) => candidate.id === selection.providerId);
  const modelId = selection.modelId?.toLowerCase();
  const binding = provider?.models.find((candidate) => candidate.id.toLowerCase() === modelId);
  const catalogModel = selection.providerId
    ? providerModels[selection.providerId]?.find((candidate) => candidate.modelId.toLowerCase() === modelId)
    : undefined;
  const recent = recentModels.find((candidate) =>
    candidate.providerId === selection.providerId && candidate.modelId.toLowerCase() === modelId,
  );
  const requested = thinkingLevel ?? recent?.thinkingLevel;
  const configured = requested === undefined ? binding : { ...binding, defaultThinkingLevel: requested };
  return catalogModel?.catalogSource === "models.dev"
    ? initialThinkingLevelForBinding(configured, provider?.supportedThinkingLevels)
    : initialThinkingLevelForUnmatchedModel(configured, provider?.supportedThinkingLevels);
}

/** Newest transcript turn that already recorded a provider/model. */
export function lastUsedSessionModel(
  messages: readonly SessionModelRef[],
): SessionModelRef {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.modelId || message.providerId) {
      return {
        ...(message.providerId ? { providerId: message.providerId } : {}),
        ...(message.modelId ? { modelId: message.modelId } : {}),
      };
    }
  }
  return {};
}

export function sessionNeedsModelPin(
  session: SessionModelRef & { source?: string },
): boolean {
  if (session.source === "pi-native" || session.source === "remote") return false;
  return !session.providerId || !session.modelId;
}

/**
 * Durable snapshot for an unpinned session: last used turn, else the current
 * recent available model. Callers persist this so later selections cannot
 * rewrite an existing chat's binding.
 */
export function pinnedSessionModelBinding({
  session,
  messages,
  settings,
  providers,
  recentModels,
}: {
  session: SessionModelRef;
  messages?: readonly SessionModelRef[];
  settings?: SessionModelSettings | null;
  providers: readonly SessionModelProvider[];
  recentModels?: readonly RecentModel[];
}): SessionModelRef {
  const used = lastUsedSessionModel(messages ?? []);
  return inheritedSessionModelBinding({
    draft: {
      providerId: session.providerId ?? used.providerId,
      modelId: session.modelId ?? used.modelId,
    },
    settings,
    providers,
    recentModels,
  });
}
