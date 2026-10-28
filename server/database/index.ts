import {serverConfig} from '../config';
import {openDatabase} from './connection';

export const db = openDatabase(serverConfig);

let closed = false;

export const closeDatabase = (): void => {
	if (closed) return;
	db.close();
	closed = true;
};
