# Upstream source

- Repository: <https://github.com/vercel-labs/agent-skills>
- Path: `skills/react-best-practices`
- Commit: `063bee94c3f4df8453406c830b0a7df0f2860278`
- Snapshot: <https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices>
- Skill name: `vercel-react-best-practices`
- Skill version: `1.0.0`
- Declared author: `vercel`; metadata organization: `Vercel Engineering`
- Retrieved: 2026-10-17
- License: MIT, as declared in the upstream `SKILL.md` frontmatter.
- Upstream `SKILL.md` SHA-256: `71ed7794962fa6e803ee83030517b5b93a9f70fbfeb431ec4535c5480a8d8355`

All 76 upstream files are preserved unchanged: `SKILL.md`, `README.md`,
`AGENTS.md`, `metadata.json`, 70 rules and two rule support files. The compiled
guide and individual rules are included together. The upstream metadata still
describes "40+ rules"; the installed snapshot contains 70.

The pinned repository does not contain a standalone license file or copyright
notice. [LICENSE](LICENSE) is a local notice that records the explicit MIT
declaration and includes the standard MIT terms. No copyright year or holder has
been invented. This file and `LICENSE` are local additions.

The Codex Skill Installer downloaded the pinned GitHub archive into this
repository. No scripts from the downloaded repository were executed. The README's
build commands describe upstream maintenance; the checked-in guide is ready to
read without installing those tools.

Project-specific scope belongs in [AGENTS.md](../../../AGENTS.md) and
[frontend/AGENTS.md](../../../frontend/AGENTS.md). In particular, private fetches
remain uncached across requests, Go owns authentication and business rules, and
the shared WebSocket invalidation flow remains the source of refresh signals.
Dependency examples such as SWR, `better-all` and `lru-cache` are guidance to
evaluate against the existing implementation.

To update, review upstream changes, replace the complete skill snapshot together,
preserve the declared license and attribution, and record the new commit and
hash here. This local copy does not require a global skill installation.
