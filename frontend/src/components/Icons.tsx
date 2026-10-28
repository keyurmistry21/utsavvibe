// Small inline icons used inside buttons and links (so the glyph and label get a real gap).
const base = { viewBox: "0 0 24 24", className: "ico", "aria-hidden": true } as const;

export const Plus = () => <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
export const ArrowLeft = () => <svg {...base}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const ArrowRight = () => <svg {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const External = () => <svg {...base}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>;
