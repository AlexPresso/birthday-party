# Source and local adaptation

- Author: Anthropic.
- Source: [code-simplifier agent](https://github.com/anthropics/claude-plugins-official/blob/ea10b213686c90bb1984b2016937310e05336cf3/plugins/code-simplifier/agents/code-simplifier.md).
- Repository revision: `ea10b213686c90bb1984b2016937310e05336cf3`.
- Retrieved: 2026-10-17.
- License: Apache-2.0; the upstream plugin's license is preserved in [LICENSE](LICENSE).
- The unmodified agent is preserved in [references/upstream-agent.md](references/upstream-agent.md) for attribution and comparison. It is not an additional instruction entrypoint.

`SKILL.md` adapts the agent into a repository-local skill. It replaces Claude-specific
configuration and JavaScript house preferences with the project's Go and React
guidance, limits cleanup to the authorized scope, and requires verification of
behavior. It does not select a model or require a Claude Code installation.
