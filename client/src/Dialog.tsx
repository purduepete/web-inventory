import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

interface PromptOptions {
    title?: string;
    message?: string;
    label?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
}

type ConfirmState = ConfirmOptions & { kind: 'confirm'; resolve: (ok: boolean) => void };
type PromptState = PromptOptions & { kind: 'prompt'; resolve: (value: string | null) => void };
type DialogState = ConfirmState | PromptState;

interface DialogApi {
    confirm: (opts: ConfirmOptions) => Promise<boolean>;
    prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<DialogState | null>(null);

    const confirm = useCallback(
        (opts: ConfirmOptions) =>
            new Promise<boolean>((resolve) => {
                setState({ kind: 'confirm', ...opts, resolve });
            }),
        []
    );

    const prompt = useCallback(
        (opts: PromptOptions) =>
            new Promise<string | null>((resolve) => {
                setState({ kind: 'prompt', ...opts, resolve });
            }),
        []
    );

    const close = useCallback((result: boolean | string | null) => {
        setState((curr) => {
            if (curr) {
                if (curr.kind === 'confirm') curr.resolve(result === true);
                else curr.resolve(typeof result === 'string' ? result : null);
            }
            return null;
        });
    }, []);

    return (
        <DialogContext.Provider value={{ confirm, prompt }}>
            {children}
            {state && <DialogHost state={state} onClose={close} />}
        </DialogContext.Provider>
    );
}

function DialogHost({ state, onClose }: { state: DialogState; onClose: (result: boolean | string | null) => void }) {
    const [value, setValue] = useState(state.kind === 'prompt' ? (state.defaultValue ?? '') : '');
    const inputRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (state.kind === 'prompt') {
            inputRef.current?.focus();
        } else {
            confirmRef.current?.focus();
        }
    }, [state]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose(state.kind === 'confirm' ? false : null);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [state, onClose]);

    function accept() {
        if (state.kind === 'confirm') onClose(true);
        else onClose(value.trim());
    }

    const title = state.title ?? (state.kind === 'confirm' ? 'Confirm' : 'Edit');
    const cancelLabel = state.cancelLabel ?? 'Cancel';
    const confirmLabel = state.confirmLabel ?? (state.kind === 'confirm' ? 'Confirm' : 'Save');
    const danger = state.kind === 'confirm' && state.danger;

    return (
        <div className="modal-backdrop" onMouseDown={() => onClose(state.kind === 'confirm' ? false : null)}>
            <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="modal-head">
                    <h2 className="modal-title">{title}</h2>
                    <button
                        type="button"
                        className="ghost small icon-btn"
                        aria-label="Close"
                        onClick={() => onClose(state.kind === 'confirm' ? false : null)}
                    >
                        <Icon name="close" size={16} />
                    </button>
                </div>

                <div className="modal-body">
                    {state.kind === 'confirm' ? (
                        <p className="modal-message">{state.message}</p>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                accept();
                            }}
                        >
                            {state.message && <p className="modal-message">{state.message}</p>}
                            {state.label && (
                                <label className="modal-label" htmlFor="modal-input">
                                    {state.label}
                                </label>
                            )}
                            <div className="input-clear">
                                <input
                                    id="modal-input"
                                    ref={inputRef}
                                    value={value}
                                    placeholder={state.placeholder}
                                    onChange={(e) => setValue(e.target.value)}
                                />
                                {value && (
                                    <button
                                        type="button"
                                        className="input-clear-btn"
                                        onClick={() => {
                                            setValue('');
                                            inputRef.current?.focus();
                                        }}
                                        data-tip="Clear"
                                        aria-label="Clear"
                                    >
                                        <Icon name="close" size={16} />
                                    </button>
                                )}
                            </div>
                        </form>
                    )}
                </div>

                <div className="modal-actions">
                    <button
                        type="button"
                        className="ghost"
                        onClick={() => onClose(state.kind === 'confirm' ? false : null)}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        ref={confirmRef}
                        className={danger ? 'danger' : ''}
                        disabled={state.kind === 'prompt' && !value.trim()}
                        onClick={accept}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function useConfirm() {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('useConfirm must be used within a DialogProvider');
    return ctx.confirm;
}

export function usePrompt() {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('usePrompt must be used within a DialogProvider');
    return ctx.prompt;
}
