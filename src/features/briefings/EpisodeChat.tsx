import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {MessageCircleQuestion, RefreshCw, Send} from 'lucide-react';
import {useEffect, useRef, useState, type FC} from 'react';
import {briefingService, HttpClientError} from '../../services';
import {isBoundedLocalCastText, unicodeCodePointLength, type ChatCitation, type ChatTurn} from '../../types';

const suggestedQuestions = [
  'What are the key points in this episode?',
  'Which supplied evidence supports the main conclusion?',
  'What does this episode leave unresolved?',
] as const;

const safeUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const Citation: FC<{citation: ChatCitation}> = ({citation}) => {
  const link = safeUrl(citation.originalUrl);
  return (
    <li>
      <strong>{citation.title}</strong> <span className="badge badge--primary">{citation.kind}</span>
      <span> · {citation.sourceName}</span>
      {citation.author ? <span> · {citation.author}</span> : null}
      {citation.publishedAt ? <span> · <time dateTime={citation.publishedAt}>{new Date(citation.publishedAt).toLocaleString()}</time></span> : null}
      <blockquote>{citation.excerpt}</blockquote>
      {link ? <a href={link} target="_blank" rel="noopener noreferrer">Open provenance for {citation.title}</a> : null}
    </li>
  );
};

const answerStatus = (turn: ChatTurn): string => {
  if (turn.state === 'queued') return 'Question queued.';
  if (turn.state === 'running') return 'Checking the episode evidence.';
  if (turn.state === 'answered') return 'Grounded answer ready.';
  if (turn.state === 'refused') return 'The episode evidence was insufficient for an answer.';
  return 'The question failed safely.';
};

type LocalActionError =
  | {kind: 'submission'; idempotencyKey: string; message: string; uncertain?: boolean}
  | {kind: 'retry'; turnId: string; idempotencyKey: string; baselineAttemptCount: number; message: string; uncertain?: boolean}
  | {kind: 'coordination'; message: string; uncertain: true};

type MutationOutcome =
  | {kind: 'response'; turn: ChatTurn}
  | {kind: 'error'; error: Error; terminal: boolean; history?: ChatTurn[]; historyCheckId?: number}
  | {kind: 'obsolete'};

type PersistedPendingAction =
  | {
    version: 2;
    runId: string;
    kind: 'submission';
    idempotencyKey: string;
    generationId: string;
    ownerId: string;
    createdAt: number;
    reconcileUntil: number;
  }
  | {
    version: 2;
    runId: string;
    kind: 'retry';
    turnId: string;
    idempotencyKey: string;
    baselineAttemptCount: 1;
    generationId: string;
    ownerId: string;
    createdAt: number;
    reconcileUntil: number;
  };

type RuntimePendingAction = PersistedPendingAction & {
  actionId: number;
  instanceEpoch: number;
  httpSettled: boolean;
  acceptedTurnId?: string;
  question?: string;
  controller?: AbortController;
};

type PendingStorageRead =
  | {kind: 'none'}
  | {kind: 'invalid'; raw: string}
  | {kind: 'valid'; raw: string; action: PersistedPendingAction};

const reconciliationWindowMs = 10_000;
const reconciliationPollMs = 500;
const maximumPendingStorageCharacters = 2_048;
const pendingStorageKey = (runId: string) => `localcast:episode-chat:pending:v2:${runId}`;
const boundedIdentity = (value: unknown): value is string => {
  return typeof value === 'string' && value === value.trim() && isBoundedLocalCastText(value, 8, 200);
};
const boundedRunIdentity = (value: unknown): value is string => (
  typeof value === 'string' && isBoundedLocalCastText(value, 1, 240)
);

const hasExactKeys = (value: Record<string, unknown>, expected: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
};

const samePersistedAction = (left: PersistedPendingAction, right: PersistedPendingAction): boolean => (
  left.version === right.version
  && left.runId === right.runId
  && left.kind === right.kind
  && left.idempotencyKey === right.idempotencyKey
  && left.generationId === right.generationId
  && left.ownerId === right.ownerId
  && left.createdAt === right.createdAt
  && left.reconcileUntil === right.reconcileUntil
  && (left.kind === 'submission' || (
    right.kind === 'retry'
    && left.turnId === right.turnId
    && left.baselineAttemptCount === right.baselineAttemptCount
  ))
);

const parsePendingAction = (raw: string, runId: string): PersistedPendingAction | undefined => {
  if (raw.length > maximumPendingStorageCharacters) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== 2
      || candidate.runId !== runId
      || !boundedRunIdentity(candidate.runId)
      || !boundedIdentity(candidate.idempotencyKey)
      || !boundedIdentity(candidate.generationId)
      || !boundedIdentity(candidate.ownerId)
      || !Number.isSafeInteger(candidate.createdAt)
      || !Number.isSafeInteger(candidate.reconcileUntil)
      || (candidate.reconcileUntil as number) < (candidate.createdAt as number)
      || (candidate.reconcileUntil as number) > (candidate.createdAt as number) + reconciliationWindowMs
    ) return undefined;
    if (candidate.kind === 'submission' && hasExactKeys(candidate, [
      'version', 'runId', 'kind', 'idempotencyKey', 'generationId', 'ownerId', 'createdAt', 'reconcileUntil',
    ])) return candidate as unknown as PersistedPendingAction;
    if (
      candidate.kind === 'retry'
      && hasExactKeys(candidate, [
        'version', 'runId', 'kind', 'turnId', 'idempotencyKey', 'baselineAttemptCount',
        'generationId', 'ownerId', 'createdAt', 'reconcileUntil',
      ])
      && boundedRunIdentity(candidate.turnId)
      && candidate.baselineAttemptCount === 1
    ) return candidate as unknown as PersistedPendingAction;
  } catch {
    // Invalid shared state never establishes acceptance or authorizes new work.
  }
  return undefined;
};

const readPendingAction = (runId: string): PendingStorageRead => {
  try {
    const raw = localStorage.getItem(pendingStorageKey(runId));
    if (!raw) return {kind: 'none'};
    const action = parsePendingAction(raw, runId);
    return action ? {kind: 'valid', raw, action} : {kind: 'invalid', raw};
  } catch {
    return {kind: 'invalid', raw: ''};
  }
};

const writePendingAction = (
  runId: string,
  action: PersistedPendingAction,
  expected?: PersistedPendingAction,
): boolean => {
  try {
    const current = readPendingAction(runId);
    if (expected) {
      if (current.kind !== 'valid' || !samePersistedAction(current.action, expected)) return false;
    } else if (current.kind === 'valid' && !samePersistedAction(current.action, action)) {
      return false;
    } else if (current.kind === 'invalid') {
      return false;
    }
    localStorage.setItem(pendingStorageKey(runId), JSON.stringify(action));
    const written = readPendingAction(runId);
    return written.kind === 'valid' && samePersistedAction(written.action, action);
  } catch {
    return false;
  }
};

const replaceInvalidPendingAction = (runId: string, raw: string, action?: PersistedPendingAction): boolean => {
  try {
    if (localStorage.getItem(pendingStorageKey(runId)) !== raw) return false;
    if (action) localStorage.setItem(pendingStorageKey(runId), JSON.stringify(action));
    else localStorage.removeItem(pendingStorageKey(runId));
    return true;
  } catch {
    return false;
  }
};

const removePendingAction = (runId: string, action: PersistedPendingAction): boolean => {
  try {
    const current = readPendingAction(runId);
    if (current.kind !== 'valid' || !samePersistedAction(current.action, action)) return false;
    localStorage.removeItem(pendingStorageKey(runId));
    return readPendingAction(runId).kind === 'none';
  } catch {
    return false;
  }
};

const persistedFromRuntime = (action: RuntimePendingAction): PersistedPendingAction => {
  const {
    actionId: _actionId,
    instanceEpoch: _instanceEpoch,
    httpSettled: _httpSettled,
    acceptedTurnId: _acceptedTurnId,
    question: _question,
    controller: _controller,
    ...persisted
  } = action;
  return persisted;
};

const responseProvesRejection = (error: Error): boolean => {
  if (!(error instanceof HttpClientError)) return false;
  if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) return true;
  return Boolean(
    error.status === 503
    && error.payload
    && typeof error.payload === 'object'
    && 'code' in error.payload
    && error.payload.code === 'PROVIDER_NOT_CONFIGURED'
  );
};

const safeMutationError = (error: unknown): Error => error instanceof Error
  ? error
  : new Error('LocalCast could not complete the chat action safely.');

const acceptedSubmission = (turns: ChatTurn[], idempotencyKey: string): ChatTurn | undefined => (
  turns.find(turn => turn.submissionId === idempotencyKey)
);

const acceptedRetry = (
  turns: ChatTurn[],
  turnId: string,
  idempotencyKey: string,
  baselineAttemptCount: number,
): ChatTurn | undefined => turns.find(turn => (
  turn.id === turnId
  && turn.acceptedRetry?.idempotencyKey === idempotencyKey
  && turn.acceptedRetry.attemptNumber === baselineAttemptCount + 1
));

const newerChatTurn = (current: ChatTurn, incoming: ChatTurn): ChatTurn => {
  if (current.updatedAt > incoming.updatedAt) return current;
  if (current.updatedAt < incoming.updatedAt) return incoming;
  const rank: Record<ChatTurn['state'], number> = {queued: 0, running: 1, failed: 2, refused: 2, answered: 2};
  return rank[current.state] > rank[incoming.state] ? current : incoming;
};

export default function EpisodeChat({runId}: {runId: string}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [localError, setLocalError] = useState<LocalActionError>();
  const [retainedError, setRetainedError] = useState<LocalActionError>();
  const [announcedTurnId, setAnnouncedTurnId] = useState<string>();
  const [reconciliationUntil, setReconciliationUntil] = useState<number>();
  const [unresolvedAction, setUnresolvedAction] = useState(false);
  const [checkingHistory, setCheckingHistory] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const instanceId = useRef(crypto.randomUUID());
  const instanceEpoch = useRef(0);
  const mounted = useRef(false);
  const currentAction = useRef<RuntimePendingAction>();
  const invalidStorageRaw = useRef<string>();
  const latestActionId = useRef(0);
  const latestHistoryCheckId = useRef(0);
  const latestCheckingHistoryId = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const queryKey = ['episode-chat', runId, instanceId.current] as const;

  useEffect(() => {
    mounted.current = true;
    const epoch = ++instanceEpoch.current;
    return () => {
      if (instanceEpoch.current !== epoch) return;
      mounted.current = false;
      const action = currentAction.current;
      if (action?.instanceEpoch === epoch) {
        action.controller?.abort();
        currentAction.current = undefined;
      }
      instanceEpoch.current += 1;
      latestActionId.current += 1;
      latestHistoryCheckId.current += 1;
      latestCheckingHistoryId.current += 1;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, [runId]);

  const isLive = (epoch: number): boolean => mounted.current && instanceEpoch.current === epoch;
  const isCurrentAction = (action: RuntimePendingAction): boolean => {
    const current = currentAction.current;
    return isLive(action.instanceEpoch)
      && current?.actionId === action.actionId
      && samePersistedAction(persistedFromRuntime(current), persistedFromRuntime(action));
  };
  const actionErrorMatches = (error: LocalActionError | undefined, action: RuntimePendingAction): boolean => {
    if (!error || error.kind !== action.kind || error.idempotencyKey !== action.idempotencyKey) return false;
    return action.kind === 'submission' || (
      error.kind === 'retry'
      && error.turnId === action.turnId
      && error.baselineAttemptCount === action.baselineAttemptCount
    );
  };
  const showActionError = (error: LocalActionError, epoch = instanceEpoch.current): void => {
    if (!isLive(epoch)) return;
    setLocalError(error);
    setRetainedError(error);
  };
  const clearActionErrors = (epoch = instanceEpoch.current): void => {
    if (!isLive(epoch)) return;
    setLocalError(undefined);
    setRetainedError(undefined);
  };
  const clearCoordinationErrors = (epoch = instanceEpoch.current): void => {
    if (!isLive(epoch)) return;
    setLocalError(current => current?.kind === 'coordination' ? undefined : current);
    setRetainedError(current => current?.kind === 'coordination' ? undefined : current);
  };
  const installInvalidStorageBlock = (raw: string, epoch: number, preserveError = false): void => {
    if (!isLive(epoch)) return;
    invalidStorageRaw.current = raw;
    setUnresolvedAction(true);
    const error: LocalActionError = {
      kind: 'coordination',
      message: 'LocalCast could not validate the shared pending-action record. It will check authoritative history before allowing another question.',
      uncertain: true,
    };
    if (preserveError) setLocalError(error);
    else showActionError(error, epoch);
  };
  const trackController = (): AbortController => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  };
  const releaseController = (controller?: AbortController): void => {
    if (controller) controllers.current.delete(controller);
  };
  const setHistory = (history: ChatTurn[], epoch: number, historyCheckId: number): boolean => {
    if (!isLive(epoch) || latestHistoryCheckId.current !== historyCheckId) return false;
    queryClient.setQueryData<ChatTurn[]>(queryKey, history);
    return true;
  };
  const focusTurn = (turnId: string, epoch: number, actionId: number): void => {
    requestAnimationFrame(() => {
      if (!isLive(epoch) || latestActionId.current !== actionId) return;
      const action = currentAction.current;
      if (action && action.actionId !== actionId && action.acceptedTurnId !== turnId) return;
      document.getElementById(`chat-turn-${turnId}`)?.focus();
    });
  };

  const installSharedAction = (
    persisted: PersistedPendingAction,
    options: {knownAcceptedTurn?: ChatTurn; preserveError?: boolean} = {},
  ): RuntimePendingAction | undefined => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch)) return undefined;
    const previous = currentAction.current;
    if (
      previous
      && previous.instanceEpoch === epoch
      && isCurrentAction(previous)
      && samePersistedAction(persistedFromRuntime(previous), persisted)
    ) {
      if (options.knownAcceptedTurn) previous.acceptedTurnId = options.knownAcceptedTurn.id;
      return previous;
    }
    previous?.controller?.abort();
    latestHistoryCheckId.current += 1;
    const action: RuntimePendingAction = {
      ...persisted,
      actionId: ++latestActionId.current,
      instanceEpoch: epoch,
      httpSettled: true,
      ...(options.knownAcceptedTurn ? {acceptedTurnId: options.knownAcceptedTurn.id} : {}),
    };
    currentAction.current = action;
    setCheckingHistory(false);
    if (options.knownAcceptedTurn) {
      setUnresolvedAction(false);
      setReconciliationUntil(undefined);
    } else {
      setUnresolvedAction(true);
      setReconciliationUntil(persisted.reconcileUntil);
      const sharedError: LocalActionError = persisted.kind === 'submission'
        ? {
          kind: 'submission',
          idempotencyKey: persisted.idempotencyKey,
          message: 'LocalCast is reconciling a shared question request. Do not submit another question.',
          uncertain: true,
        }
        : {
          kind: 'retry',
          turnId: persisted.turnId,
          idempotencyKey: persisted.idempotencyKey,
          baselineAttemptCount: persisted.baselineAttemptCount,
          message: 'LocalCast is reconciling a shared retry request. No competing retry is allowed.',
          uncertain: true,
        };
      if (options.preserveError) setLocalError(sharedError);
      else showActionError(sharedError, epoch);
    }
    return action;
  };

  const finishCurrentAction = (action: RuntimePendingAction): void => {
    if (!isCurrentAction(action)) return;
    releaseController(action.controller);
    removePendingAction(runId, persistedFromRuntime(action));
    currentAction.current = undefined;
    latestHistoryCheckId.current += 1;
    setReconciliationUntil(undefined);
    setUnresolvedAction(false);
    setCheckingHistory(false);
    const shared = readPendingAction(runId);
    if (shared.kind === 'valid' && !samePersistedAction(shared.action, persistedFromRuntime(action))) {
      installSharedAction(shared.action, {preserveError: true});
    } else if (shared.kind === 'invalid') {
      installInvalidStorageBlock(shared.raw, action.instanceEpoch, true);
    }
  };

  const applyAcceptedAction = (turn: ChatTurn, action: RuntimePendingAction): boolean => {
    if (!isCurrentAction(action)) return false;
    if (action.acceptedTurnId === turn.id && (turn.state === 'queued' || turn.state === 'running')) {
      action.httpSettled = true;
      const clearMatching = (current?: LocalActionError) => actionErrorMatches(current, action) ? undefined : current;
      setLocalError(clearMatching);
      setRetainedError(clearMatching);
      setReconciliationUntil(undefined);
      setUnresolvedAction(false);
      return true;
    }
    action.httpSettled = true;
    action.acceptedTurnId = turn.id;
    latestHistoryCheckId.current += 1;
    const preserveUnlessMatching = (current?: LocalActionError) => actionErrorMatches(current, action) ? undefined : current;
    setLocalError(preserveUnlessMatching);
    setRetainedError(preserveUnlessMatching);
    setAnnouncedTurnId(turn.id);
    if (action.kind === 'submission' && action.question !== undefined) {
      setQuestion(current => current.trim() === action.question ? '' : current);
    }
    if (turn.state === 'queued' || turn.state === 'running') {
      setReconciliationUntil(undefined);
      setUnresolvedAction(false);
    } else {
      finishCurrentAction(action);
    }
    focusTurn(turn.id, action.instanceEpoch, action.actionId);
    return true;
  };

  const createAuthoritativeRecord = (turn: ChatTurn): PersistedPendingAction => {
    const createdAt = Date.now();
    const common = {
      version: 2 as const,
      runId,
      idempotencyKey: turn.acceptedRetry?.idempotencyKey || turn.submissionId,
      generationId: crypto.randomUUID(),
      ownerId: instanceId.current,
      createdAt,
      reconcileUntil: createdAt + reconciliationWindowMs,
    };
    return turn.acceptedRetry?.attemptNumber === 2
      ? {...common, kind: 'retry', turnId: turn.id, baselineAttemptCount: 1}
      : {...common, kind: 'submission'};
  };

  const recoverFromInvalidStorageComparison = (history: ChatTurn[], epoch: number): void => {
    if (!isLive(epoch)) return;
    let shared = readPendingAction(runId);
    if (shared.kind === 'none') {
      const active = history.find(turn => turn.state === 'queued' || turn.state === 'running');
      if (active) {
        const record = createAuthoritativeRecord(active);
        if (writePendingAction(runId, record)) shared = {kind: 'valid', raw: JSON.stringify(record), action: record};
        else shared = readPendingAction(runId);
      }
    }
    if (shared.kind === 'valid') {
      invalidStorageRaw.current = undefined;
      clearCoordinationErrors(epoch);
      const accepted = shared.action.kind === 'submission'
        ? acceptedSubmission(history, shared.action.idempotencyKey)
        : acceptedRetry(history, shared.action.turnId, shared.action.idempotencyKey, shared.action.baselineAttemptCount);
      installSharedAction(shared.action, {knownAcceptedTurn: accepted, preserveError: true});
      return;
    }
    if (shared.kind === 'invalid') {
      installInvalidStorageBlock(shared.raw, epoch, true);
      return;
    }
    invalidStorageRaw.current = undefined;
    clearCoordinationErrors(epoch);
    setUnresolvedAction(false);
  };

  const adoptAuthoritativeTurn = (
    turn: ChatTurn,
    replaced?: RuntimePendingAction,
    preserveError = false,
  ): RuntimePendingAction | undefined => {
    if (!isLive(instanceEpoch.current)) return undefined;
    const record = createAuthoritativeRecord(turn);
    const expected = replaced ? persistedFromRuntime(replaced) : undefined;
    let written = writePendingAction(runId, record, expected);
    if (!written && readPendingAction(runId).kind === 'none') written = writePendingAction(runId, record);
    if (!written) {
      const shared = readPendingAction(runId);
      if (shared.kind === 'valid') return installSharedAction(shared.action, {
        knownAcceptedTurn: samePersistedAction(shared.action, record) ? turn : undefined,
        preserveError,
      });
      setUnresolvedAction(true);
      return undefined;
    }
    return installSharedAction(record, {knownAcceptedTurn: turn, preserveError});
  };

  const rejectAction = (action: RuntimePendingAction, error: Error, history?: ChatTurn[]): void => {
    if (!isCurrentAction(action)) return;
    showActionError(
      action.kind === 'submission'
        ? {kind: 'submission', idempotencyKey: action.idempotencyKey, message: error.message}
        : {
          kind: 'retry',
          turnId: action.turnId,
          idempotencyKey: action.idempotencyKey,
          baselineAttemptCount: action.baselineAttemptCount,
          message: error.message,
        },
      action.instanceEpoch,
    );
    const active = history?.find(turn => turn.state === 'queued' || turn.state === 'running');
    if (active) adoptAuthoritativeTurn(active, action, true);
    else finishCurrentAction(action);
  };

  const reconcilePendingHistory = (history: ChatTurn[]): boolean => {
    const action = currentAction.current;
    if (!action?.httpSettled || !isCurrentAction(action)) return false;
    const accepted = action.kind === 'submission'
      ? acceptedSubmission(history, action.idempotencyKey)
      : acceptedRetry(history, action.turnId, action.idempotencyKey, action.baselineAttemptCount);
    if (accepted) return applyAcceptedAction(accepted, action);

    const active = history.find(turn => turn.state === 'queued' || turn.state === 'running');
    if (active) {
      const competingTurn = action.kind === 'retry' && active.id !== action.turnId;
      const competingRetry = action.kind === 'retry'
        && active.id === action.turnId
        && active.acceptedRetry
        && active.acceptedRetry.idempotencyKey !== action.idempotencyKey;
      const competingSubmission = action.kind === 'submission' && active.submissionId !== action.idempotencyKey;
      if (competingTurn || competingRetry || competingSubmission) {
        rejectAction(action, new Error(
          action.kind === 'submission'
            ? 'A different question was accepted first. This question was not accepted.'
            : competingTurn
              ? 'A different question was accepted first. This retry was not accepted.'
            : 'A different retry request was accepted. This retry was not accepted.',
        ), history);
        return true;
      }
    }
    return false;
  };

  const chat = useQuery({
    queryKey,
    queryFn: async ({signal}) => {
      const epoch = instanceEpoch.current;
      if (!isLive(epoch)) return queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
      const historyCheckId = ++latestHistoryCheckId.current;
      try {
        const history = await briefingService.getChatTurns(runId, signal);
        if (!isLive(epoch) || latestHistoryCheckId.current !== historyCheckId) {
          return queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
        }
        return history;
      } catch (error) {
        if (!isLive(epoch) || latestHistoryCheckId.current !== historyCheckId) {
          return queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
        }
        throw error;
      }
    },
    retry: false,
    refetchInterval: query => (
      query.state.data?.some(turn => turn.state === 'queued' || turn.state === 'running')
      || (reconciliationUntil !== undefined && Date.now() < reconciliationUntil)
    ) ? reconciliationPollMs : false,
  });

  const mutation = useMutation({
    mutationFn: async (action: RuntimePendingAction): Promise<MutationOutcome> => {
      if (!isCurrentAction(action)) return {kind: 'obsolete'};
      try {
        const turn = action.kind === 'submission'
          ? await briefingService.askEpisodeQuestion(runId, action.question!, action.idempotencyKey, action.controller?.signal)
          : await briefingService.retryEpisodeQuestion(runId, action.turnId, action.idempotencyKey, action.controller?.signal);
        if (!isCurrentAction(action)) return {kind: 'obsolete'};
        return {kind: 'response', turn};
      } catch (error) {
        if (!isCurrentAction(action)) return {kind: 'obsolete'};
        const safeError = safeMutationError(error);
        const historyCheckId = ++latestHistoryCheckId.current;
        try {
          const history = await briefingService.getChatTurns(runId, action.controller?.signal);
          if (!isCurrentAction(action)) return {kind: 'obsolete'};
          if (latestHistoryCheckId.current !== historyCheckId) {
            return {kind: 'error', error: safeError, terminal: responseProvesRejection(safeError)};
          }
          return {kind: 'error', error: safeError, terminal: responseProvesRejection(safeError), history, historyCheckId};
        } catch {
          if (!isCurrentAction(action)) return {kind: 'obsolete'};
          return {kind: 'error', error: safeError, terminal: responseProvesRejection(safeError)};
        }
      }
    },
    onSuccess: (outcome, action) => {
      if (!isCurrentAction(action) || outcome.kind === 'obsolete') return;
      releaseController(action.controller);
      action.controller = undefined;
      action.httpSettled = true;

      if (outcome.kind === 'response') {
        const historyCheckId = ++latestHistoryCheckId.current;
        const prior = queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
        const history = prior.some(turn => turn.id === outcome.turn.id)
          ? prior.map(turn => turn.id === outcome.turn.id ? newerChatTurn(turn, outcome.turn) : turn)
          : [...prior, outcome.turn];
        if (!setHistory(history, action.instanceEpoch, historyCheckId) || !isCurrentAction(action)) return;
        if (!reconcilePendingHistory(history)) {
          setReconciliationUntil(action.reconcileUntil);
          setUnresolvedAction(true);
          showActionError(
            action.kind === 'submission'
              ? {kind: 'submission', idempotencyKey: action.idempotencyKey, message: 'LocalCast returned a mismatched submission identity. It will keep checking the exact request identity.', uncertain: true}
              : {kind: 'retry', turnId: action.turnId, idempotencyKey: action.idempotencyKey, baselineAttemptCount: action.baselineAttemptCount, message: 'LocalCast returned a mismatched retry identity. It will keep checking the exact retry identity.', uncertain: true},
            action.instanceEpoch,
          );
        }
        return;
      }

      if (outcome.history) {
        const installed = outcome.historyCheckId !== undefined
          && setHistory(outcome.history, action.instanceEpoch, outcome.historyCheckId);
        if (!isCurrentAction(action)) return;
        if (installed) {
          if (reconcilePendingHistory(outcome.history)) return;
      } else {
        const newerHistory = queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
        if (reconcilePendingHistory(newerHistory)) return;
      }
	  } else {
		const newerHistory = queryClient.getQueryData<ChatTurn[]>(queryKey) || [];
		if (reconcilePendingHistory(newerHistory)) return;
      }
      if (action.acceptedTurnId) return;
      if (outcome.terminal) {
        rejectAction(action, outcome.error, outcome.history);
        return;
      }
      setReconciliationUntil(action.reconcileUntil);
      setUnresolvedAction(true);
      showActionError(
        action.kind === 'submission'
          ? {kind: 'submission', idempotencyKey: action.idempotencyKey, message: 'LocalCast could not confirm whether this question was accepted. It will keep checking the exact request identity; do not submit another question.', uncertain: true}
          : {kind: 'retry', turnId: action.turnId, idempotencyKey: action.idempotencyKey, baselineAttemptCount: action.baselineAttemptCount, message: 'LocalCast could not confirm whether this retry was accepted. It will keep checking the exact retry identity; no other retry is allowed.', uncertain: true},
        action.instanceEpoch,
      );
    },
  });

  const turns = chat.data || [];
  const activeTurn = turns.find(turn => turn.state === 'queued' || turn.state === 'running');
  const visibleError = localError || retainedError;
  const interactionBlocked = chat.isLoading || chat.isError || Boolean(activeTurn) || mutation.isPending || unresolvedAction || Boolean(visibleError?.uncertain);
  const announcedTurn = announcedTurnId ? turns.find(turn => turn.id === announcedTurnId) : undefined;
  const trimmedQuestion = question.trim();
  const questionCharacters = unicodeCodePointLength(question);
  const validQuestion = isBoundedLocalCastText(trimmedQuestion, 1, 1_000);

  const fetchAndReconcile = async (action?: RuntimePendingAction): Promise<void> => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch) || (action && !isCurrentAction(action))) return;
    const historyCheckId = ++latestHistoryCheckId.current;
    const checkingHistoryId = ++latestCheckingHistoryId.current;
    const controller = trackController();
    setCheckingHistory(true);
    try {
      const history = await briefingService.getChatTurns(runId, controller.signal);
      if (!isLive(epoch) || latestHistoryCheckId.current !== historyCheckId) return;
      if (action && !isCurrentAction(action)) return;
      if (!setHistory(history, epoch, historyCheckId)) return;
      const invalidRaw = invalidStorageRaw.current;
      if (invalidRaw !== undefined) {
        const active = history.find(turn => turn.state === 'queued' || turn.state === 'running');
        if (active) {
          const record = createAuthoritativeRecord(active);
          if (replaceInvalidPendingAction(runId, invalidRaw, record)) {
            invalidStorageRaw.current = undefined;
            installSharedAction(record, {knownAcceptedTurn: active, preserveError: true});
            clearCoordinationErrors(epoch);
          } else recoverFromInvalidStorageComparison(history, epoch);
        } else if (replaceInvalidPendingAction(runId, invalidRaw)) {
          invalidStorageRaw.current = undefined;
          setUnresolvedAction(false);
          clearCoordinationErrors(epoch);
        } else recoverFromInvalidStorageComparison(history, epoch);
      }
      reconcilePendingHistory(history);
    } catch {
      if (!isLive(epoch) || latestHistoryCheckId.current !== historyCheckId) return;
      if (action && !isCurrentAction(action)) return;
      const retainUncertainty = (current?: LocalActionError) => {
        if (!current?.uncertain) return current;
        if (action && !actionErrorMatches(current, action)) return current;
        return {...current, message: 'LocalCast still cannot confirm the action. The exact identity remains blocked; try checking history again later.'};
      };
      setLocalError(retainUncertainty);
      setRetainedError(retainUncertainty);
    } finally {
      releaseController(controller);
      if (isLive(epoch) && latestCheckingHistoryId.current === checkingHistoryId) setCheckingHistory(false);
    }
  };

  useEffect(() => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch)) return;
    const stored = readPendingAction(runId);
    if (stored.kind === 'valid') {
      const action = installSharedAction(stored.action);
      void fetchAndReconcile(action);
      return;
    }
    if (stored.kind === 'invalid') {
      installInvalidStorageBlock(stored.raw, epoch);
    }
  }, [runId]);

  useEffect(() => {
    const epoch = instanceEpoch.current;
    const onStorage = (event: StorageEvent) => {
      if (!isLive(epoch) || event.key !== pendingStorageKey(runId) || event.storageArea !== localStorage) return;
      latestHistoryCheckId.current += 1;
      const stored = readPendingAction(runId);
      if (stored.kind === 'valid') {
        const action = installSharedAction(stored.action);
        void fetchAndReconcile(action);
      } else {
        if (stored.kind === 'invalid') installInvalidStorageBlock(stored.raw, epoch, true);
        void fetchAndReconcile(currentAction.current);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [runId]);

  useEffect(() => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch) || chat.isLoading || chat.isError) return;
    if (invalidStorageRaw.current !== undefined) {
      void fetchAndReconcile(currentAction.current);
      return;
    }
    if (currentAction.current) {
      reconcilePendingHistory(turns);
      return;
    }
    if (activeTurn) {
      const stored = readPendingAction(runId);
      if (stored.kind === 'valid') {
        const action = installSharedAction(stored.action, {
          knownAcceptedTurn: (stored.action.kind === 'submission' && stored.action.idempotencyKey === activeTurn.submissionId)
            || (stored.action.kind === 'retry' && stored.action.idempotencyKey === activeTurn.acceptedRetry?.idempotencyKey)
            ? activeTurn
            : undefined,
        });
        if (action) reconcilePendingHistory(turns);
      } else if (stored.kind === 'none') {
        const record = createAuthoritativeRecord(activeTurn);
        if (writePendingAction(runId, record)) installSharedAction(record, {knownAcceptedTurn: activeTurn});
      }
    }
  }, [turns, chat.isLoading, chat.isError, activeTurn?.id, activeTurn?.state, mutation.isPending]);

  useEffect(() => {
    if (!visibleError) return;
    const epoch = instanceEpoch.current;
    const frame = requestAnimationFrame(() => {
      if (isLive(epoch)) errorSummary.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleError]);

  useEffect(() => {
    if (activeTurn && activeTurn.id !== announcedTurnId) setAnnouncedTurnId(activeTurn.id);
  }, [activeTurn?.id, announcedTurnId]);

  useEffect(() => {
    const action = currentAction.current;
    if (!action || !visibleError?.uncertain || reconciliationUntil === undefined) return;
    const epoch = action.instanceEpoch;
    const actionId = action.actionId;
    const expire = () => {
      if (!isLive(epoch) || currentAction.current?.actionId !== actionId) return;
      const update = (current?: LocalActionError) => current?.uncertain && actionErrorMatches(current, action) ? {
        ...current,
        message: current.kind === 'submission'
          ? 'LocalCast could not confirm this question within the bounded check window. The exact request identity remains blocked; check history again later.'
          : 'LocalCast could not confirm this retry within the bounded check window. The exact retry identity remains blocked; check history again later.',
      } : current;
      setLocalError(update);
      setRetainedError(update);
      setReconciliationUntil(undefined);
    };
    const remaining = reconciliationUntil - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timeout = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timeout);
  }, [reconciliationUntil, visibleError?.kind, visibleError?.uncertain]);

  const beginAction = (record: PersistedPendingAction, questionValue?: string): RuntimePendingAction | undefined => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch)) return undefined;
    const stored = readPendingAction(runId);
    if (stored.kind === 'valid' && !samePersistedAction(stored.action, record)) {
      const shared = installSharedAction(stored.action);
      void fetchAndReconcile(shared);
      return undefined;
    }
    if (stored.kind === 'invalid' || !writePendingAction(runId, record)) {
      const current = readPendingAction(runId);
      if (current.kind === 'valid') {
        const shared = installSharedAction(current.action);
        void fetchAndReconcile(shared);
        return undefined;
      }
      invalidStorageRaw.current = stored.kind === 'invalid' ? stored.raw : current.kind === 'invalid' ? current.raw : undefined;
      setUnresolvedAction(true);
      showActionError({
        kind: 'coordination',
        message: 'LocalCast could not preserve a shared action identity safely, so nothing was submitted.',
        uncertain: true,
      }, epoch);
      return undefined;
    }
    const controller = trackController();
    const action: RuntimePendingAction = {
      ...record,
      actionId: ++latestActionId.current,
      instanceEpoch: epoch,
      httpSettled: false,
      ...(questionValue === undefined ? {} : {question: questionValue}),
      controller,
    };
    currentAction.current = action;
    setUnresolvedAction(true);
    setReconciliationUntil(record.reconcileUntil);
    clearActionErrors(epoch);
    mutation.mutate(action);
    return action;
  };

  const chooseSuggestion = (value: string) => {
    const epoch = instanceEpoch.current;
    if (!isLive(epoch)) return;
    clearActionErrors(epoch);
    setQuestion(value);
    requestAnimationFrame(() => {
      if (isLive(epoch)) textarea.current?.focus();
    });
  };

  const recheckUncertainAction = async () => {
    const action = currentAction.current;
    if (!action && invalidStorageRaw.current === undefined) return;
    await fetchAndReconcile(action);
  };

  return (
    <section className="card card--padded-lg episode-chat" aria-labelledby="episode-chat-heading">
      <div className="episode-chat__heading">
        <MessageCircleQuestion size={22} aria-hidden="true" className="icon-primary" />
        <div>
          <h2 id="episode-chat-heading" className="card__title">Ask about this episode</h2>
          <p className="field-help">Answers are limited to this episode&apos;s frozen transcript and evidence snapshots.</p>
        </div>
      </div>

      <div className="inline-notice episode-chat__disclosure" role="note" aria-label="External provider disclosure">
        <strong>External provider disclosure:</strong> If the configured text provider is external, it receives your question, this episode&apos;s complete frozen transcript, and all frozen supporting evidence snapshots used to construct grounding. A supported answer can require a second external semantic-support request; an evidence-insufficient refusal ordinarily requires one request. Provider-side response storage is disabled through <code>store: false</code>. A locally hosted provider processes the same context locally. LocalCast enables no tools, search, browsing, URL retrieval, file search, or general-knowledge fallback.
      </div>

      <div className="episode-chat__suggestions" aria-labelledby="suggested-questions-heading">
        <h3 id="suggested-questions-heading">Suggested questions</h3>
        <div className="page-actions page-actions--wrap">
          {suggestedQuestions.map(suggestion => (
            <button
              key={suggestion}
              type="button"
              className="button button--secondary"
              disabled={interactionBlocked}
              onClick={() => chooseSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <form
        className="episode-chat__form"
        onSubmit={event => {
          event.preventDefault();
          if (!validQuestion || interactionBlocked) return;
          const createdAt = Date.now();
          beginAction({
            version: 2,
            runId,
            kind: 'submission',
            idempotencyKey: crypto.randomUUID(),
            generationId: crypto.randomUUID(),
            ownerId: instanceId.current,
            createdAt,
            reconcileUntil: createdAt + reconciliationWindowMs,
          }, trimmedQuestion);
        }}
      >
        <label htmlFor="episode-chat-question">Question</label>
        <textarea
          ref={textarea}
          id="episode-chat-question"
          value={question}
          rows={4}
          required
          disabled={interactionBlocked || mutation.isPending}
          aria-invalid={question.length > 0 && !validQuestion}
          aria-describedby="episode-chat-help episode-chat-count"
          onChange={event => {
            const value = event.target.value;
            clearActionErrors();
            setQuestion(value);
          }}
        />
        <div className="episode-chat__form-meta">
          <span id="episode-chat-help" className="field-help">LocalCast rejects answers that are not fully supported by the frozen episode evidence.</span>
          <span id="episode-chat-count" className="field-help">{questionCharacters} / 1000</span>
        </div>
        <button className="button button--primary" type="submit" disabled={!validQuestion || interactionBlocked || mutation.isPending}>
          <Send size={16} aria-hidden="true" /> {mutation.isPending
            ? 'Submitting…'
            : chat.isLoading ? 'Loading question history…' : activeTurn ? 'Question in progress' : 'Ask this episode'}
        </button>
      </form>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcedTurn ? answerStatus(announcedTurn) : ''}
      </p>
      {visibleError ? <p ref={errorSummary} className="inline-notice" role="alert" tabIndex={-1}>The chat action could not be completed safely: {visibleError.message}</p> : null}
      {visibleError?.uncertain ? (
        <button className="button button--secondary" type="button" disabled={checkingHistory} onClick={() => void recheckUncertainAction()}>
          <RefreshCw size={16} aria-hidden="true" /> {checkingHistory ? 'Checking question history…' : 'Check question history again'}
        </button>
      ) : null}
      {chat.isError ? <p className="inline-notice" role="status">Question history is unavailable. LocalCast will not submit anything unless history becomes available.</p> : null}

      <div className="episode-chat__history" aria-labelledby="episode-chat-history-heading" aria-busy={Boolean(activeTurn)}>
        <h3 id="episode-chat-history-heading">Question history</h3>
        {chat.isLoading ? <p role="status">Loading question history…</p> : null}
        {!chat.isLoading && turns.length === 0 ? <p className="field-help">No questions have been submitted for this episode.</p> : null}
        <ol className="episode-chat__turns">
          {turns.map((turn, index) => (
            <li key={turn.id}>
              <article className="episode-chat__turn" aria-labelledby={`chat-turn-${turn.id}`}>
                <div className="episode-chat__turn-header">
                  <h4 id={`chat-turn-${turn.id}`} tabIndex={-1}>Question {index + 1}</h4>
                  <span className="badge badge--primary">{turn.state}</span>
                </div>
                <p className="episode-chat__question">{turn.question}</p>
                {(turn.state === 'queued' || turn.state === 'running') ? <p>{answerStatus(turn)}</p> : null}
                {turn.state === 'answered' ? (
                  <div className="episode-chat__answer-stack">
                    <h5>Grounded answer</h5>
                    {turn.claims.map(claim => (
                      <div key={claim.id} className="episode-chat__answer">
                        <p>{claim.text}</p>
                        <ul className="section-subgroup" aria-label={`Validated citations for answer to question ${index + 1}`}>
                          {claim.citations.map((citation, citationIndex) => <Citation key={`${citation.snapshotId}-${citationIndex}`} citation={citation} />)}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
                {turn.state === 'refused' ? (
                  <p className="inline-notice">The frozen episode transcript and evidence do not support a reliable answer to this question. LocalCast did not use outside knowledge.</p>
                ) : null}
                {turn.state === 'failed' ? (
                  <div className="inline-notice">
                    <p>{turn.errorMessage || 'The follow-up request failed safely.'}</p>
                    <p className="field-help">Code: {turn.errorCode || 'CHAT_FAILED'} · attempt {turn.attemptCount}</p>
                    {turn.retryable ? (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={interactionBlocked}
                        onClick={() => {
                          if (interactionBlocked) return;
                          const createdAt = Date.now();
                          beginAction({
                            version: 2,
                            runId,
                            kind: 'retry',
                            turnId: turn.id,
                            idempotencyKey: crypto.randomUUID(),
                            baselineAttemptCount: 1,
                            generationId: crypto.randomUUID(),
                            ownerId: instanceId.current,
                            createdAt,
                            reconcileUntil: createdAt + reconciliationWindowMs,
                          });
                        }}
                      >
                        <RefreshCw size={16} aria-hidden="true" /> {mutation.isPending ? 'Retrying…' : 'Retry question'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {turn.attempts.length > 1 ? (
                  <details>
                    <summary>Attempt history</summary>
                    <ol>{turn.attempts.map(attempt => <li key={attempt.attemptNumber}>Attempt {attempt.attemptNumber}: {attempt.outcome}{attempt.errorCode ? ` (${attempt.errorCode})` : ''}</li>)}</ol>
                  </details>
                ) : null}
                <p className="field-help"><time dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString()}</time></p>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
