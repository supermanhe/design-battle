export function buildEntryPrompt({ brief, skill, entryDir }) {
  return `You are one contestant in an isolated frontend design battle.

Build a complete, polished response to this brief:

${brief}

Mandatory design skill:
- Read and follow exactly one primary design skill: ${skill.stagedPath || skill.path}
- Its original source is recorded as: ${skill.path}
- Do not load or use any other design skill.
- You may use ordinary coding and browser-validation tools.

Output contract:
- Work only inside this contestant directory: ${entryDir}
- Create the final standalone page at: ${entryDir}/site/index.html
- You may create local static assets only under: ${entryDir}/site/
- The page must load directly in an iframe without a development server or build step.
- Do not read or access sibling contestant directories.
- Do not modify any existing user project.
- Finish the implementation, not merely a plan or explanation.
`;
}
