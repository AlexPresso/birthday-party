/** The app's mark: a small cluster of lights in the theme colors. */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="30"
      height="20"
      viewBox="0 0 30 20"
      aria-hidden="true"
    >
      <circle cx="6" cy="13" r="4" style={{ fill: "var(--highlight)" }} />
      <circle cx="15.5" cy="8" r="5.5" style={{ fill: "var(--accent)" }} />
      <circle
        cx="24.5"
        cy="14"
        r="3.5"
        style={{ fill: "var(--highlight-pale)" }}
      />
      <circle cx="8" cy="4" r="1.8" style={{ fill: "var(--highlight-pale)" }} />
      <circle cx="24" cy="4.5" r="1.5" style={{ fill: "var(--highlight)" }} />
      <circle cx="14" cy="17.5" r="1.2" style={{ fill: "var(--highlight)" }} />
    </svg>
  );
}
