import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {serverConfig} from '../config';
import {applyMigrations} from './migrations';

const resolveDatabasePath = (databasePath: string): string => {
	if (databasePath === ':memory:') return databasePath;
	return path.resolve(process.cwd(), databasePath);
};

const databasePath = resolveDatabasePath(serverConfig.databasePath);

if (databasePath !== ':memory:') {
	fs.mkdirSync(path.dirname(databasePath), {recursive: true});
}

export const db = new Database(databasePath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

applyMigrations(db);

export const closeDatabase = (): void => {
	db.close();
};

