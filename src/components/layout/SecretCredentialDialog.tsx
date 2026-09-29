import {useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent} from 'react';

interface SecretCredentialDialogProps {
	title: string;
	description: string;
	onCancel: () => void;
	onReplace: (value: string) => Promise<void>;
}

const focusableSelector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SecretCredentialDialog({title, description, onCancel, onReplace}: SecretCredentialDialogProps) {
	const titleId = useId();
	const descriptionId = useId();
	const helpId = useId();
	const dialog = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		input.current?.focus();
	}, []);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape' && !busy) {
			event.preventDefault();
			setValue('');
			onCancel();
			return;
		}
		if (event.key !== 'Tab') return;
		const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) || [])];
		const first = controls[0];
		const last = controls.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		const submittedValue = value;
		setValue('');
		setBusy(true);
		setError(undefined);
		try {
			await onReplace(submittedValue);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'LocalCast could not replace the OpenAI API key.');
		} finally {
			setBusy(false);
			window.setTimeout(() => input.current?.focus(), 0);
		}
	};

	return (
		<div className="confirm-dialog-backdrop">
			<div
				ref={dialog}
				className="confirm-dialog"
				role="dialog"
				tabIndex={-1}
				aria-modal="true"
				aria-busy={busy}
				aria-labelledby={titleId}
				aria-describedby={`${descriptionId} ${helpId}`}
				onKeyDown={handleKeyDown}
			>
				<h2 id={titleId} className="confirm-dialog__title">{title}</h2>
				<p id={descriptionId}>{description}</p>
				<form className="form-stack" onSubmit={event => void handleSubmit(event)}>
					<div className="field">
						<label className="field-label" htmlFor="openai-api-key">Complete new API key</label>
						<input
							ref={input}
							id="openai-api-key"
							className="control"
							type="password"
							value={value}
							onChange={event => setValue(event.target.value)}
							autoComplete="new-password"
							autoCapitalize="none"
							spellCheck={false}
							minLength={20}
							maxLength={512}
							required
							readOnly={busy}
							aria-describedby={helpId}
						/>
						<span id={helpId} className="field-help">Paste the complete key. The existing key is never shown or prefilled.</span>
					</div>
					{error && <p role="alert" className="inline-notice inline-notice--danger">{error}</p>}
					<div className="form-actions">
						<button type="button" className="button button--secondary" onClick={() => { setValue(''); onCancel(); }} disabled={busy}>Cancel</button>
						<button type="submit" className="button button--primary" disabled={busy}>
							{busy ? 'Replacing…' : 'Replace API key'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
