export type ThemePreference = 'system' | 'light' | 'midnight';

// iOS saves whichever site icon is linked when the app is added to the home screen.
export const SITE_ICONS = {
    light: '/apple-touch-icon-light.png?v=2',
    dark: '/apple-touch-icon.png?v=2',
} as const;

export function readTheme(): ThemePreference {
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'system') return saved;
    } catch {
        /* Storage can be unavailable in private browsing. */
    }
    return 'midnight';
}

export function applyTheme(preference: ThemePreference, systemDark: boolean) {
    const theme =
        preference === 'system' ? (systemDark ? 'dark' : 'light') : preference === 'midnight' ? 'dark' : 'light';
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('theme-midnight', theme === 'dark');
    root.style.colorScheme = theme;
    root.style.backgroundColor = theme === 'light' ? '#ffffff' : '#020617';
    document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'light' ? '#ffffff' : '#020617');
    document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', SITE_ICONS[theme]);
    return theme;
}

export function trackTheme(preference: ThemePreference, onChange: (theme: 'light' | 'dark') => void) {
    // Save once per choice. Saving on OS changes would let an open tab overwrite another tab's choice.
    try {
        localStorage.setItem('theme', preference);
    } catch {
        /* Keep the theme usable without storage. */
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => onChange(applyTheme(preference, media.matches));
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
}
