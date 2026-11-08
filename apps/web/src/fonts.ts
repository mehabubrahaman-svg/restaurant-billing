/*
 * Bundled fonts (architecture §5.8): nothing is fetched from the internet.
 * Inter is the face (one variable file per script range, so every weight the
 * type scale uses comes from one download), and the Devanagari and Bengali
 * scripts come from their own Noto families. `@fontsource/noto-sans` stays a
 * dependency for the printed slips, which Chromium draws with Noto.
 */
import '@fontsource-variable/inter/wght.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-500.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-500.css';
import '@fontsource/noto-sans-bengali/bengali-600.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
