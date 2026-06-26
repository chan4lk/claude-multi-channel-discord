export interface ClarityResult {
  score: number;
  gaps: string[];
  isLarge: boolean;
}

export function evaluateClarity(proposalText: string): ClarityResult {
  const lines = proposalText.split('\n');
  const gaps: string[] = [];
  let score = 100;

  // --- Section extraction helpers ---
  function getSectionText(headings: string[]): string {
    const headingPatterns = headings.map(h => h.toLowerCase());
    let inSection = false;
    const sectionLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        const title = trimmed.slice(3).toLowerCase();
        if (headingPatterns.some(p => title === p)) {
          inSection = true;
          continue;
        } else if (inSection) {
          break;
        }
      }
      if (inSection) sectionLines.push(line);
    }
    return sectionLines.join('\n');
  }

  function hasSectionHeading(headings: string[]): boolean {
    const patterns = headings.map(h => h.toLowerCase());
    return lines.some(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('## ')) return false;
      const title = trimmed.slice(3).toLowerCase();
      return patterns.some(p => title === p);
    });
  }

  function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  function getAcBullets(text: string): string[] {
    return text.split('\n').filter(l => l.trim().startsWith('- '));
  }

  // --- isLarge heuristics ---
  const solutionText = getSectionText(['proposed solution', 'solution']);
  const solutionWords = countWords(solutionText);

  const acText = getSectionText(['acceptance criteria']);
  const acBullets = getAcBullets(acText);

  const filenamePattern = /(?:[\w/.-]+\/[\w.-]+\.ts|[\w.-]+\.ts)/g;
  const allFilenames = proposalText.match(filenamePattern) ?? [];
  const uniqueFilenames = new Set(allFilenames);

  const isLarge =
    solutionWords >= 300 ||
    acBullets.length >= 5 ||
    uniqueFilenames.size >= 4;

  // --- Score deductions ---
  const hasProblem = hasSectionHeading(['problem', 'problem statement']);
  if (!hasProblem) {
    score -= 30;
    gaps.push('Missing problem statement section');
  }

  const hasAcSection = hasSectionHeading(['acceptance criteria']);
  const hasAcBullets = hasAcSection && acBullets.length > 0;
  if (!hasAcSection || !hasAcBullets) {
    score -= 25;
    gaps.push('Missing acceptance criteria');
  }

  const hasScope = hasSectionHeading(['scope']);
  if (!hasScope) {
    score -= 20;
    gaps.push('Missing scope definition');
  }

  if (hasAcSection && hasAcBullets && acBullets.length < 3) {
    score -= 15;
    gaps.push('Fewer than 3 acceptance criteria');
  }

  if (solutionWords < 50) {
    score -= 10;
    gaps.push('Solution description too vague (under 50 words)');
  }

  if (score < 0) score = 0;

  return { score, gaps, isLarge };
}
