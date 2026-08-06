import type {Note, Station} from '../../types';
import type {StationService} from './index';
import {apiRequest} from './httpClient';

export class ApiStationService implements StationService {
  async getNotes(): Promise<Note[]> {
    return apiRequest<Note[]>('/notes');
  }

  async saveNote(input: Pick<Note, 'title' | 'body' | 'author' | 'originalUrl'>, id?: string): Promise<Note> {
    return apiRequest<Note>(id ? `/notes/${encodeURIComponent(id)}` : '/notes', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteNote(id: string): Promise<void> {
    await apiRequest(`/notes/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }

  async getStations(): Promise<Station[]> {
    return apiRequest<Station[]>('/stations');
  }

  async saveStation(input: Pick<Station, 'name' | 'topicInstruction' | 'defaultMode' | 'noteIds' | 'sourceIds'>, id?: string): Promise<Station> {
    return apiRequest<Station>(id ? `/stations/${encodeURIComponent(id)}` : '/stations', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteStation(id: string): Promise<void> {
    await apiRequest(`/stations/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }
}
