import {serverConfig} from './config';
import {openDatabase} from './database/connection';
import {initializeStorage} from './storage';

if (serverConfig.processRole !== 'storage-init') {
	throw new Error('LOCALCAST_PROCESS_ROLE must be storage-init for storage initialization');
}

initializeStorage(serverConfig);
const database = openDatabase(serverConfig, {initializingStorage: true});
database.close();

console.log('LocalCast storage initialized');
