import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { attachTooltip } from './tooltipController';

export function Tooltip() {
    const id = useId();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current!.setAttribute('popover', 'manual');
        return attachTooltip(ref.current!);
    }, []);
    return createPortal(<div ref={ref} id={id} className="tooltip" role="tooltip" hidden />, document.body);
}
