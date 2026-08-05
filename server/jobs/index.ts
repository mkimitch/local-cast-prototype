import {db} from '../database/index';
import {GenerationJobStore} from './generationJobStore';

export const generationJobStore = new GenerationJobStore(db);
