// Shared by the submission form and the import/build pipeline.
export const GENERATION_TOOLS = Object.freeze(['Suno', 'Claude', 'FLSM', 'Musio', 'Muse']);

export function normalizeGenerationTools(value) {
  if (value === undefined || value === null || value === '') return [];
  const entries = typeof value === 'string' ? value.split(/[,、]/) : value;
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
    throw new Error('generationTools must be a list of Suno, Claude, FLSM, Musio or Muse');
  }
  const result = [];
  for (const entry of entries) {
    const name = entry.trim();
    if (!name) continue;
    const canonical = GENERATION_TOOLS.find(tool => tool.toLowerCase() === name.toLowerCase());
    if (!canonical) throw new Error(`Unknown generation tool: ${name}. Choose Suno, Claude, FLSM, Musio or Muse`);
    if (!result.includes(canonical)) result.push(canonical);
  }
  return result;
}
