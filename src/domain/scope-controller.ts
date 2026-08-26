export type ScopeBuckets = {
  launch: string[];
  next: string[];
  future: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function organizeScope(
  ideas: string[],
  launchPriorities: string[],
  nextPriorities: string[],
): ScopeBuckets {
  const normalizedIdeas = unique(ideas);
  const launchSet = new Set(unique(launchPriorities));
  const nextSet = new Set(unique(nextPriorities));

  return {
    launch: normalizedIdeas.filter((idea) => launchSet.has(idea)),
    next: normalizedIdeas.filter(
      (idea) => !launchSet.has(idea) && nextSet.has(idea),
    ),
    future: normalizedIdeas.filter(
      (idea) => !launchSet.has(idea) && !nextSet.has(idea),
    ),
  };
}
