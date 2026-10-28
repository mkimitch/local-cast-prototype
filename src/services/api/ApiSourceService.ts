import type {MaterialSearchResult, Source, SourceItem} from '../../types';
import type {SourceService} from './index';
import {apiRequest} from './httpClient';

export class ApiSourceService implements SourceService {
  async getSources(): Promise<Source[]> {
    return apiRequest<Source[]>('/sources');
  }

  async getSourceItems(sourceId: string): Promise<SourceItem[]> {
    return apiRequest<SourceItem[]>(`/sources/${encodeURIComponent(sourceId)}/items?limit=50`);
  }

  async addSource(source: Pick<Source, 'type' | 'name' | 'url' | 'description' | 'category' | 'isActive'>): Promise<Source> {
    return apiRequest<Source>('/sources', {
      method: 'POST',
      body: JSON.stringify(source),
    });
  }

  async updateSource(id: string, source: Partial<Pick<Source, 'name' | 'url'>> & {description?: string | null; category?: string | null}): Promise<Source> {
    return apiRequest<Source>(`/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(source),
    });
  }

  async toggleSource(id: string, isActive: boolean): Promise<void> {
    await apiRequest<Source>(`/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({isActive}),
    });
  }

  async syncSource(id: string): Promise<{insertedCount: number; updatedCount: number; notModified?: boolean; message?: string}> {
    return apiRequest(`/sources/${encodeURIComponent(id)}/sync`, {method: 'POST'});
  }

  async searchMaterials(query: string): Promise<MaterialSearchResult[]> {
    return apiRequest<MaterialSearchResult[]>(`/materials?q=${encodeURIComponent(query)}&limit=50`);
  }

  async deleteSource(id: string): Promise<void> {
    await apiRequest<void>(`/sources/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }
}
