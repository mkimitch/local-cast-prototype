import {BackupRestoreError, restoreVersionedBackup} from './operations/backupRestore';

const parseArguments = (arguments_: string[]): Map<string, string> => {
	const values = new Map<string, string>();
	for (let index = 0; index < arguments_.length; index += 2) {
		const key = arguments_[index];
		const value = arguments_[index + 1];
		if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
			throw new BackupRestoreError('ARGUMENT_INVALID', 'Restore arguments must be unique name/value pairs');
		}
		values.set(key, value);
	}
	return values;
};

const main = (): void => {
	const arguments_ = parseArguments(process.argv.slice(2));
	const backupPath = arguments_.get('--backup');
	const dataTargetPath = arguments_.get('--data-target');
	const mediaTargetPath = arguments_.get('--media-target');
	if (!backupPath || !dataTargetPath || !mediaTargetPath || arguments_.size !== 3) {
		throw new BackupRestoreError('ARGUMENT_INVALID', 'Required restore arguments are missing');
	}
	const manifest = restoreVersionedBackup({backupPath, dataTargetPath, mediaTargetPath});
	process.stdout.write(`LOCALCAST_RESTORE_COMPLETE|format=${manifest.formatVersion}|mediaFiles=${manifest.media.fileCount}|mediaBytes=${manifest.media.totalBytes}|providerStatus=NOT_CONFIGURED\n`);
};

try {
	main();
} catch (error) {
	const code = error instanceof BackupRestoreError ? error.code : 'UNEXPECTED_FAILURE';
	process.stderr.write(`LOCALCAST_RESTORE_FAILED|code=${code}\n`);
	process.exitCode = 1;
}
