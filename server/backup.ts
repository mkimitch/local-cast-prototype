import {BackupRestoreError, createVersionedBackup} from './operations/backupRestore';

const parseArguments = (arguments_: string[]): Map<string, string> => {
	const values = new Map<string, string>();
	for (let index = 0; index < arguments_.length; index += 2) {
		const key = arguments_[index];
		const value = arguments_[index + 1];
		if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
			throw new BackupRestoreError('ARGUMENT_INVALID', 'Backup arguments must be unique name/value pairs');
		}
		values.set(key, value);
	}
	return values;
};

const main = async (): Promise<void> => {
	const arguments_ = parseArguments(process.argv.slice(2));
	const databasePath = arguments_.get('--database');
	const mediaPath = arguments_.get('--media');
	const destinationPath = arguments_.get('--destination');
	const maximumMediaBytes = Number(arguments_.get('--max-media-bytes'));
	if (!databasePath || !mediaPath || !destinationPath || arguments_.size !== 4) {
		throw new BackupRestoreError('ARGUMENT_INVALID', 'Required backup arguments are missing');
	}
	const manifest = await createVersionedBackup({databasePath, mediaPath, destinationPath, maximumMediaBytes});
	process.stdout.write(`LOCALCAST_BACKUP_COMPLETE|format=${manifest.formatVersion}|mediaFiles=${manifest.media.fileCount}|mediaBytes=${manifest.media.totalBytes}\n`);
};

main().catch(error => {
	const code = error instanceof BackupRestoreError ? error.code : 'UNEXPECTED_FAILURE';
	process.stderr.write(`LOCALCAST_BACKUP_FAILED|code=${code}\n`);
	process.exitCode = 1;
});
