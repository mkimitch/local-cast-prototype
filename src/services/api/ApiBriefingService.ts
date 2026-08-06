import type {BriefingRun, EpisodeMode} from '../../types';
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

  async startRun(sourceIds: string[]): Promise<BriefingRun> {
    return apiRequest<BriefingRun>('/briefing-runs', {
      method: 'POST',
      headers: {'Idempotency-Key': crypto.randomUUID()},
      body: JSON.stringify({sourceIds}),
    });
  }

  async startStationRun(stationId: string, mode?: EpisodeMode): Promise<BriefingRun> {
    return apiRequest<BriefingRun>('/briefing-runs', {
      method: 'POST',
      headers: {'Idempotency-Key': crypto.randomUUID()},
      body: JSON.stringify({stationId, mode}),
    });
  }
}
