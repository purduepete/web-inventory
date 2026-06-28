import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

export type SelectOption = { value: string; label: string; disabled?: boolean };

interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
    /** Render with auto width instead of full-width (e.g. inline controls). */
    auto?: boolean;
}

export function Select({ value, onChange, options, placeholder, ariaLabel, className, style, auto }: SelectProps) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const selectedIndex = options.findIndex((o) => o.value === value);
    const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
    const triggerLabel = selected ? selected.label : (placeholder ?? '');
    const isPlaceholder = !selected || selected.value === '';

    const firstEnabled = () => {
        const i = options.findIndex((o) => !o.disabled);
        return i < 0 ? 0 : i;
    };

    // Close when clicking outside.
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    // When opening, highlight the current selection (or first enabled option).
    useEffect(() => {
        if (open) setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Keep the highlighted option in view.
    useEffect(() => {
        if (!open) return;
        const el = listRef.current?.children[active] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    }, [active, open]);

    const step = (dir: 1 | -1) => {
        setActive((cur) => {
            let i = cur;
            for (let n = 0; n < options.length; n++) {
                i = (i + dir + options.length) % options.length;
                if (!options[i].disabled) return i;
            }
            return cur;
        });
    };

    const commit = (i: number) => {
        const opt = options[i];
        if (!opt || opt.disabled) return;
        onChange(opt.value);
        setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                step(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                step(-1);
                break;
            case 'Home':
                e.preventDefault();
                setActive(firstEnabled());
                break;
            case 'End':
                e.preventDefault();
                for (let i = options.length - 1; i >= 0; i--) {
                    if (!options[i].disabled) {
                        setActive(i);
                        break;
                    }
                }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                commit(active);
                break;
            case 'Escape':
                e.preventDefault();
                setOpen(false);
                break;
            case 'Tab':
                setOpen(false);
                break;
        }
    };

    return (
        <div
            ref={rootRef}
            className={`select${open ? ' open' : ''}${auto ? ' auto' : ''}${className ? ' ' + className : ''}`}
            style={style}
        >
            <button
                type="button"
                className="select-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={onKeyDown}
            >
                <span className={`select-value${isPlaceholder ? ' placeholder' : ''}`}>{triggerLabel}</span>
                <Icon name="chevron" size={16} className="select-chevron" />
            </button>
            {open && (
                <div ref={listRef} className="select-panel" role="listbox" id={listId} tabIndex={-1}>
                    {options.map((opt, i) => (
                        <button
                            type="button"
                            key={opt.value || `opt-${i}`}
                            className={`select-option${i === active ? ' active' : ''}`}
                            role="option"
                            aria-selected={opt.value === value}
                            disabled={opt.disabled}
                            onMouseEnter={() => !opt.disabled && setActive(i)}
                            onClick={() => commit(i)}
                        >
                            <span className="select-option-label">{opt.label}</span>
                            <Icon name="check" size={15} className="select-check" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
