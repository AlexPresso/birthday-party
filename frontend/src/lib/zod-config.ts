import { z } from "zod";

// Zod probes `new Function` once to decide whether it may compile its parsers.
// The Content Security Policy blocks that probe and reports it as a violation,
// although Zod catches the failure. Opting out keeps CSP reports meaningful.
// Import this module for its side effect wherever data is first parsed.
z.config({ jitless: true });
