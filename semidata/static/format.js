/* Shared display formatting and HTML escaping. */
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (value, digits = 4) =>
  value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });
export const precise = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value) === 0
      ? "0"
      : Math.abs(value) < 0.001 || Math.abs(value) >= 1e7
        ? Number(value).toExponential(3)
        : Number(value).toLocaleString(undefined, {
            maximumSignificantDigits: 6,
          });
export const date = (value) =>
  !value
    ? "Not recorded"
    : Number.isNaN(new Date(value).valueOf())
      ? String(value)
      : new Date(value).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
