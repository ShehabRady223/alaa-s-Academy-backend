/** Makes user text safe to embed in a RegExp (prevents regex injection / ReDoS via metacharacters). */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
