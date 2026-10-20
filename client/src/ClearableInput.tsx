import { forwardRef } from 'react';
import { Icon } from './Icon';

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
    onClear: () => void;
    wrapperClassName?: string;
};

/** Text input with an inline "X" clear button shown inside the field when non-empty. */
export const ClearableInput = forwardRef<HTMLInputElement, Props>(
    ({ onClear, value, wrapperClassName, ...rest }, ref) => (
        <span className={`input-clear${wrapperClassName ? ' ' + wrapperClassName : ''}`}>
            <input ref={ref} value={value} {...rest} />
            {value ? (
                <button type="button" className="input-clear-btn" aria-label="Clear" onClick={onClear}>
                    <Icon name="close" size={16} />
                </button>
            ) : null}
        </span>
    )
);
