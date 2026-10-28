// Placeholder artwork until product images are supported: warm gradient + initials, stable per title.
const palettes = [
  ["#fde6c4", "#f2a65a"], ["#fbd3d0", "#e5736a"], ["#ffe9a8", "#e8b923"],
  ["#d6ecd2", "#6fb57a"], ["#e2d7fb", "#9477e6"], ["#cfe5f7", "#5f9fd6"],
];

export function ProductArt({ title, size = "sm" }: { title: string; size?: "sm" | "lg" }) {
  const h = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [a, b] = palettes[h % palettes.length];
  const initials = title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className={`art-ph ${size}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-hidden="true">
      <span>{initials}</span>
    </div>
  );
}
