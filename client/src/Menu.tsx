import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuItem = { title: string; description?: string; icon?: IconName; onSelect: () => void; disabled?: boolean };

interface MenuProps {
    icon: IconName;
    label: string;
    items: MenuItem[];
    disabled?: boolean;
    className?: string;
}

/** A click-to-open action menu: a trigger (icon + label) that drops a list of
 *  titled options, each with an optional muted description. */
export function Menu({ icon, label, items, disabled, className }: MenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: Event) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('touchstart', onDoc);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('touchstart', onDoc);
        };
    }, [open]);

    const choose = (it: MenuItem) => {
        if (it.disabled) return;
        setOpen(false);
        it.onSelect();
    };

    return (
        <div ref={rootRef} className={`menu${open ? ' open' : ''}${className ? ' ' + className : ''}`}>
            <button
                type="button"
                className="menu-trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
            >
                <Icon name={icon} size={18} />
                <span>{label}</span>
                <Icon name="chevron" size={16} className="menu-chevron" />
            </button>
            {open && (
                <div className="menu-panel" role="menu">
                    {items.map((it, i) => (
                        <button
                            type="button"
                            key={i}
                            className="menu-item"
                            role="menuitem"
                            disabled={it.disabled}
                            onTouchEnd={(e) => {
                                e.preventDefault();
                                choose(it);
                            }}
                            onClick={() => choose(it)}
                        >
                            {it.icon && <Icon name={it.icon} size={18} className="menu-item-icon" />}
                            <span className="menu-item-text">
                                <span className="menu-item-title">{it.title}</span>
                                {it.description && <span className="menu-item-desc">{it.description}</span>}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
