import type {BriefingRun, ChatTurn, EpisodeMode} from '../../types';
import type {BriefingService} from './index';
import {apiRequest, HttpClientError} from './httpClient';

export class ApiBriefingService implements BriefingService {
  async getRuns(): Promise<BriefingRun[]> {
    return apiRequest<BriefingRun[]>('/briefing-runs');
  }

  async getRun(id: string): Promise<BriefingRun | undefined> {
    try {
      return await apiRequest<BriefingRun>(`/briefing-runs/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof HttpClientError && error.status === 404) return undefined;
      throw error;
    }
  }

  async startStationRun(stationId: string, mode?: EpisodeMode): Promise<BriefingRun> {
    return apiRequest<BriefingRun>('/briefing-runs', {
      method: 'POST',
      headers: {'Idempotency-Key': crypto.randomUUID()},
      body: JSON.stringify({stationId, mode}),
    });
  }

  async retryRun(id: string): Promise<BriefingRun> {
    return apiRequest<BriefingRun>(`/briefing-runs/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      headers: {'Idempotency-Key': crypto.randomUUID()},
    });
  }

  async getChatTurns(runId: string, signal?: AbortSignal): Promise<ChatTurn[]> {
    return apiRequest<ChatTurn[]>(`/briefing-runs/${encodeURIComponent(runId)}/chat-turns`, {signal});
  }

  async askEpisodeQuestion(runId: string, question: string, idempotencyKey: string, signal?: AbortSignal): Promise<ChatTurn> {
    return apiRequest<ChatTurn>(`/briefing-runs/${encodeURIComponent(runId)}/chat-turns`, {
      method: 'POST',
      headers: {'Idempotency-Key': idempotencyKey},
      body: JSON.stringify({question}),
      signal,
    });
  }

  async retryEpisodeQuestion(runId: string, turnId: string, idempotencyKey: string, signal?: AbortSignal): Promise<ChatTurn> {
    return apiRequest<ChatTurn>(`/briefing-runs/${encodeURIComponent(runId)}/chat-turns/${encodeURIComponent(turnId)}/retry`, {
      method: 'POST',
      headers: {'Idempotency-Key': idempotencyKey},
      signal,
    });
  }
}
