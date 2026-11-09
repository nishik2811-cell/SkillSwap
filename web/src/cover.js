// One cover per person: colour and catalogue number come from the username, so they look the same everywhere.
export const COVERS = ['#e8b57f', '#aec6a2', '#cfcfd9', '#ece6cd', '#e8946c', '#8896bd', '#e8bf5a', '#7f8fff'];
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export const coverOf = (username) => { const h = hash(username); return { bg: COVERS[h % COVERS.length], cat: `SS-${String((h % 9000) + 1000)}` }; };
