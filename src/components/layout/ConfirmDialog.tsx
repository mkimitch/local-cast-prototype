import {useEffect, useRef, type KeyboardEvent} from 'react';

interface ConfirmDialogProps {
	title: string;
	description: string;
	confirmLabel: string;
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({title, description, confirmLabel, busy = false, onCancel, onConfirm}: ConfirmDialogProps) {
	const dialog = useRef<HTMLDivElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancel.current?.focus();
	}, []);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape' && !busy) {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key !== 'Tab') return;
		const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) || [])];
		if (controls.length === 0) return;
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

	return (
		<div className="confirm-dialog-backdrop">
			<div
				ref={dialog}
				className="confirm-dialog"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				aria-describedby="confirm-dialog-description"
				onKeyDown={handleKeyDown}
			>
				<h2 id="confirm-dialog-title" className="confirm-dialog__title">{title}</h2>
				<p id="confirm-dialog-description">{description}</p>
				<div className="form-actions">
					<button ref={cancel} type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
					<button type="button" className="button button--danger" onClick={onConfirm} disabled={busy}>
						{busy ? 'Deleting…' : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
