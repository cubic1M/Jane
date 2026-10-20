// Registry tools (the features Claude can look at, src/lib/jane-agent/claude-tools.ts) that no
// detector covers yet and that are not exempt (src/config/detector-exempt.ts), a ratchet: the
// list only shrinks (spec step 254). Each sector lane removes its tools as it adds detectors
// with `covers: [toolName]`. src/detectors/detectors.test.ts fails for a tool that is covered
// but still listed here, and for a tool that is not covered, not exempt and not listed. A new
// tool is never added to this list: it arrives with its detector or an exemption.

export const MISSING_DETECTOR: readonly string[] = ["life_events"];
