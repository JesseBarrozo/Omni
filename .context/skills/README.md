# Skills

On-demand expertise for AI agents. Skills are task-specific procedures that get activated when relevant.

> Project: Omni

## How Skills Work

1. **Discovery**: AI agents discover available skills
2. **Matching**: When a task matches a skill's description, it's activated
3. **Execution**: The skill's instructions guide the AI's behavior

## Available Skills

### Project Skills

| Skill | Description | Phases |
|-------|-------------|--------|
| [Commit Message](./commit-message/SKILL.md) | Commit one validated phase with a scoped conventional message | E, C |
| [PR Review](./pr-review/SKILL.md) | Check a phase change against evidence and acceptance criteria | R, V |
| [Code Review](./code-review/SKILL.md) | Review runtime wiring, security, and mock boundaries | R, V |
| [Test Generation](./test-generation/SKILL.md) | Add unit or real integration tests with evidence labels | E, V |
| [Documentation](./documentation/SKILL.md) | Keep claims and commands aligned with verified behavior | P, C |
| [Refactoring](./refactoring/SKILL.md) | Refactor only behavior protected by relevant tests | E |
| [Bug Investigation](./bug-investigation/SKILL.md) | Reproduce and diagnose actual CLI/core behavior | E, V |

## Creating Custom Skills

Create a new skill by adding a directory with a `SKILL.md` file:

```
.context/skills/
└── my-skill/
    ├── SKILL.md          # Required: source skill definition
    ├── scripts/          # Optional: deterministic helpers
    ├── references/       # Optional: load-on-demand details
    └── assets/           # Optional: output resources
```

### Skill Anatomy

```md
The source file under `.context/skills/` keeps internal scaffold metadata so dotcontext can track fill status.
When exported to AI-tool skill directories, the portable frontmatter should keep only:

---
name: my-skill
description: Describe what the skill does and the concrete triggers for when to use it
---

## Workflow
1. Step one
2. Step two

## Examples
```
[Short example]
```

## Quality Bar
- List the checks and constraints that keep the skill reliable

## Resource Strategy
- Explain when to add `scripts/`, `references/`, or `assets/`
```

Keep activation language in the description frontmatter, keep the body concise, and avoid extra docs such as `README.md` or `CHANGELOG.md` inside the skill folder.

## PREVC Phase Mapping

| Phase | Name | Skills |
|-------|------|--------|
| P | Planning | documentation |
| R | Review | pr-review, code-review |
| E | Execution | commit-message, test-generation, refactoring, bug-investigation |
| V | Validation | pr-review, code-review, test-generation, bug-investigation |
| C | Confirmation | commit-message, documentation |
