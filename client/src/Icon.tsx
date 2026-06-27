import type { SVGProps } from 'react';

export type IconName =
    | 'search'
    | 'box'
    | 'boxes'
    | 'camera'
    | 'plus'
    | 'printer'
    | 'trash'
    | 'close'
    | 'scan'
    | 'sync'
    | 'sparkles'
    | 'check'
    | 'move'
    | 'chevron'
    | 'sun'
    | 'moon'
    | 'users';

const paths: Record<IconName, JSX.Element> = {
    search: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
        </>
    ),
    box: (
        <>
            <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
            <path d="m3 8 9 5 9-5" />
            <path d="M12 13v8" />
        </>
    ),
    boxes: (
        <>
            <path d="M2.5 8.5 7 6l4.5 2.5L7 11Z" />
            <path d="M2.5 8.5V14l4.5 2.5V11Z" />
            <path d="M11.5 8.5 7 11v5.5" />
            <path d="M13 5.5 17.5 3 22 5.5 17.5 8Z" />
            <path d="M13 5.5V11l4.5 2.5V8Z" />
            <path d="M22 5.5V11l-4.5 2.5" />
        </>
    ),
    camera: (
        <>
            <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4Z" />
            <circle cx="12" cy="13" r="3.5" />
        </>
    ),
    plus: (
        <>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </>
    ),
    printer: (
        <>
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="7" rx="1" />
        </>
    ),
    trash: (
        <>
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
            <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
        </>
    ),
    close: (
        <>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </>
    ),
    scan: (
        <>
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M7 12h10" />
        </>
    ),
    sync: (
        <>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 4v4h-4" />
            <path d="M3 20v-4h4" />
        </>
    ),
    sparkles: (
        <>
            <path d="M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z" />
            <path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7Z" />
        </>
    ),
    check: (
        <>
            <path d="M20 6 9 17l-5-5" />
        </>
    ),
    move: (
        <>
            <path d="M5 9 2 12l3 3" />
            <path d="M9 5l3-3 3 3" />
            <path d="M15 19l-3 3-3-3" />
            <path d="M19 9l3 3-3 3" />
            <path d="M2 12h20" />
            <path d="M12 2v20" />
        </>
    ),
    chevron: (
        <>
            <path d="m9 18 6-6-6-6" />
        </>
    ),
    sun: (
        <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.9 4.9 1.4 1.4" />
            <path d="m17.7 17.7 1.4 1.4" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.3 17.7-1.4 1.4" />
            <path d="m19.1 4.9-1.4 1.4" />
        </>
    ),
    moon: (
        <>
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </>
    ),
    users: (
        <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
    ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
    name: IconName;
    size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}
        >
            {paths[name]}
        </svg>
    );
}
