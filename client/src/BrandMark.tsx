// The site icon's labeled box, colored by the --brand-* tokens so it follows the theme.
export function BrandMark({ size = 26 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="10 9 44 44" aria-hidden="true" focusable="false">
            <path
                d="M32 11 51 20.5 32 30 13 20.5Z"
                fill="var(--brand-sky)"
                fillOpacity=".18"
                stroke="var(--brand-sky)"
                strokeWidth="3"
                strokeLinejoin="round"
            />
            <path
                d="M13 20.5v21L32 51l19-9.5v-21M32 30v21"
                fill="none"
                stroke="var(--brand-amber)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d="M36 35.5 46.5 30.3v6.4L36 42Z" fill="var(--brand-orange)" />
            <path d="M19 30.5l7 3.5" stroke="var(--brand-steel)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
    );
}
