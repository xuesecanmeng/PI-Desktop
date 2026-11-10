import type {
  ContextCompactionMark,
  MessageUsage,
  ModelInfo,
  ProviderPublic,
  UiMessage,
} from "@pi-desktop/shared";
import { DEFAULT_CONTEXT_WINDOW, resolveKnownContextWindow } from "./context-usage";
import { getSessionMessageSnapshot } from "./session-transcript-updates";
import { getTranscriptProjection } from "./transcript-projection";
import { getAssistantTurnSummary } from "./transcript-summary";

export type LatestTurnContextInspector = {
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  contextWindowEstimated?: boolean;
  tools: UiMessage[];
  responseDurationMs?: number;
  responseOutputTokens?: number;
  responseOutputEstimated: boolean;
  /** The newest checkpoint's full request estimate, until newer real usage. */
  estimatedOccupancyTokens?: number;
};

const inspectors = new WeakMap<object, LatestTurnContextInspector>();

function sameUsage(previous: MessageUsage, next: MessageUsage): boolean {
  return previous === next || (
    Object.keys(previous).length === Object.keys(next).length &&
    Object.keys(next).every((key) => previous[key as keyof MessageUsage] === next[key as keyof MessageUsage])
  );
}

/**
 * The composer mirrors the newest parent turn with usage, not a later live turn
 * without totals. It shares the transcript projection instead of rebuilding it.
 */
export function latestTurnContextInspector(
  messages: UiMessage[],
  providerModels: Record<string, ModelInfo[]>,
  providers: ProviderPublic[],
  compactions?: readonly ContextCompactionMark[],
  currentModel?: { providerId?: string; modelId?: string },
): LatestTurnContextInspector | undefined {
  let latestUsageMessage: UiMessage | undefined;
  let latestUsageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message.parentToolCallId && message.usage) {
      latestUsageMessage = message;
      latestUsageIndex = index;
      break;
    }
  }
  const latestUsage = latestUsageMessage?.usage;
  if (!latestUsage) return undefined;

  const latestMark = compactions?.at(-1);
  const boundaryIndex = latestMark
    ? messages.findIndex((message) => message.id === latestMark.throughMessageId)
    : -1;
  const localEstimate = latestMark?.tokensAfter;
  const estimate =
    localEstimate !== undefined && Number.isFinite(localEstimate) && localEstimate >= 0
      ? localEstimate
      : latestMark?.contextTokens;
  const estimatedOccupancyTokens =
    estimate !== undefined && Number.isFinite(estimate) && estimate >= 0 &&
    boundaryIndex >= latestUsageIndex
      ? Math.round(estimate)
      : undefined;

  const windowModel = estimatedOccupancyTokens !== undefined
    ? latestMark?.providerId && latestMark.modelId
      ? latestMark
      : currentModel?.providerId && currentModel.modelId
        ? currentModel
        : latestUsageMessage
    : latestUsageMessage;
  const knownContextWindow = resolveKnownContextWindow(
    windowModel?.providerId, windowModel?.modelId, providerModels, providers,
  );

  const { entries } = getTranscriptProjection(messages, compactions);
  let latestTurn: ReturnType<typeof getAssistantTurnSummary> | undefined;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind !== "assistant-turn") continue;
    const summary = getAssistantTurnSummary(entry);
    latestTurn ??= summary;
    if (summary.usage) {
      latestTurn = summary;
      break;
    }
  }
  const result: LatestTurnContextInspector = {
    usage: latestUsage,
    turnUsage: latestTurn?.usage ?? latestUsage,
    contextWindow: knownContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    ...(knownContextWindow === undefined ? { contextWindowEstimated: true } : {}),
    tools: latestTurn?.tools ?? [],
    responseDurationMs: latestTurn?.responseDurationMs,
    responseOutputTokens: latestTurn?.responseOutputTokens,
    responseOutputEstimated: latestTurn?.responseOutputEstimated ?? false,
    estimatedOccupancyTokens,
  };
  const owner = getSessionMessageSnapshot(messages).owner;
  const previous = inspectors.get(owner);
  if (previous && previous.usage === result.usage &&
    sameUsage(previous.turnUsage, result.turnUsage) &&
    previous.contextWindow === result.contextWindow &&
    previous.contextWindowEstimated === result.contextWindowEstimated &&
    previous.responseDurationMs === result.responseDurationMs &&
    previous.responseOutputTokens === result.responseOutputTokens &&
    previous.responseOutputEstimated === result.responseOutputEstimated &&
    previous.estimatedOccupancyTokens === result.estimatedOccupancyTokens &&
    previous.tools.length === result.tools.length &&
    previous.tools.every((tool, index) => tool === result.tools[index])
  ) return previous;
  inspectors.set(owner, result);
  return result;
}
