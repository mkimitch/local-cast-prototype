import type {Source} from '../../types';
import type {SourceService} from './index';
import {apiRequest} from './httpClient';

export class ApiSourceService implements SourceService {
  async getSources(): Promise<Source[]> {
    return apiRequest<Source[]>('/sources');
  }

  async addSource(source: Omit<Source, 'id' | 'addedAt'>): Promise<Source> {
    return apiRequest<Source>('/sources', {
      method: 'POST',
      body: JSON.stringify(source),
    });
  }

  async toggleSource(id: string, isActive: boolean): Promise<void> {
    await apiRequest<Source>(`/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({isActive}),
    });
  }

  async deleteSource(id: string): Promise<void> {
    await apiRequest<void>(`/sources/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }
}
