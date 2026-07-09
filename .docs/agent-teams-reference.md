# Agent Teams — Master Reference Guide

> Source: https://code.claude.com/docs/en/agent-teams  
> Claude Code min version: v2.1.178+  
> Status: **Experimental** — disabled by default

---

## Enable

Set in `~/.claude/settings.json` (or project `settings.json`):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

---

## Core Concept

One **lead** session coordinates multiple independent **teammate** sessions. Each teammate has its own context window. Teammates communicate directly with each other (not just back to the lead) via a shared task list and a mailbox messaging system.

**Key distinction from subagents:**

| | Subagents | Agent Teams |
|---|---|---|
| Context | Own window; results return to caller | Own window; fully independent |
| Communication | Back to main agent only | Teammates message each other directly |
| Coordination | Main agent manages all | Shared task list; self-coordination |
| Best for | Focused tasks where only the result matters | Complex work needing discussion/collaboration |
| Token cost | Lower | Higher (each teammate = separate Claude instance) |

---

## Architecture

| Component | Role |
|---|---|
| **Team lead** | Main Claude Code session; spawns and coordinates |
| **Teammates** | Separate Claude Code instances with assigned tasks |
| **Task list** | Shared work items teammates claim and complete |
| **Mailbox** | Direct inter-agent messaging |

**Storage paths** (auto-generated, session-derived name = `session-{first-8-chars-of-session-id}`):

```
~/.claude/teams/{team-name}/config.json   ← removed on session exit
~/.claude/tasks/{team-name}/              ← persists for resumed sessions
```

Do not hand-author the team config — it is overwritten on every state update.

**Task states:** `pending` → `in_progress` → `completed`  
Tasks can have dependencies; a task with unresolved deps cannot be claimed until those deps complete. File locking prevents race conditions when multiple teammates claim simultaneously.

---

## Display Modes

| Mode | Description | Requirement |
|---|---|---|
| `in-process` (default) | All teammates inside your main terminal | Any terminal |
| `auto` | Split panes if tmux/iTerm2 detected, else in-process | tmux or iTerm2 |
| `tmux` | Split panes, auto-detect tmux vs iTerm2 | tmux or iTerm2 |
| `iterm2` | iTerm2 native split panes explicitly | `it2` CLI + Python API enabled |

Set globally in `~/.claude/settings.json`:
```json
{ "teammateMode": "auto" }
```

Or per-session:
```bash
claude --teammate-mode auto
```

**In-process navigation:**
- `↑ / ↓` — select teammate in agent panel
- `Enter` — open transcript and message that teammate
- `Escape` — interrupt selected teammate's current turn
- `x` — stop selected teammate
- `Ctrl+T` — toggle task list

Idle teammate rows hide after 30 seconds and reappear on next turn (v2.1.181+). Teammate is still running and addressable while hidden.

---

## Spawning Teammates

Describe the task and roles in natural language. Claude spawns based on your instructions and won't spawn without your approval.

```text
Spawn three teammates to review PR #142:
- One focused on security implications
- One checking performance impact
- One validating test coverage
```

Specify model explicitly if needed:
```text
Spawn 4 teammates to refactor these modules in parallel. Use Sonnet for each teammate.
```

Teammates do **not** inherit the lead's `/model` by default. Set **Default teammate model** in `/config`, or pick "Default (leader's model)" to follow the lead's model.

Teammates **do** inherit the lead's effort level (v2.1.186+ for split-pane mode).

### Using Subagent Definitions as Teammates

Define a role once (in project, user, plugin, or CLI scope) and reuse it:

```text
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

The teammate honors that definition's `tools` allowlist and `model`; the body appends to the system prompt rather than replacing it. Team tools (`SendMessage`, task tools) are always available even when `tools` restricts others.

> Note: `skills` and `mcpServers` frontmatter in subagent definitions are **not** applied when running as a teammate — teammates load from project/user settings.

### Plan Approval Mode

Require teammates to plan before implementing:

```text
Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes.
```

1. Teammate works read-only in plan mode
2. Sends plan approval request to lead
3. Lead approves (auto) or rejects with feedback
4. On rejection, teammate revises and resubmits
5. On approval, teammate exits plan mode and implements

Influence lead's approval criteria in your prompt: "only approve plans that include test coverage."

---

## Context Each Teammate Receives

- CLAUDE.md (from working directory)
- MCP servers and skills (from project/user settings)
- Spawn prompt from lead
- **Does NOT** inherit lead's conversation history

Include all task-specific details in the spawn prompt:

```text
Spawn a security reviewer teammate with the prompt: "Review the authentication
module at src/auth/ for security vulnerabilities. Focus on token handling,
session management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report any issues with severity ratings."
```

---

## Communication Between Agents

- **Messaging:** Send to one specific teammate by name. To reach everyone, send one message per recipient.
- **Idle notifications:** Teammate automatically notifies lead when it stops.
- **Shared task list:** All agents see task status and claim available work.
- **Automatic delivery:** Messages arrive without polling.

Teammates discover each other via the team config's `members` array (name, agent ID, agent type).

---

## Permissions

Teammates start with the lead's permission settings. If lead runs with `--dangerously-skip-permissions`, all teammates do too. You can change individual teammate modes after spawning, but not at spawn time.

Pre-approve common operations in permission settings before spawning to reduce interruption friction.

---

## Hooks

| Hook | Trigger | Exit 2 Effect |
|---|---|---|
| `TeammateIdle` | Teammate about to go idle | Send feedback; keep teammate working |
| `TaskCreated` | Task being created | Prevent creation; send feedback |
| `TaskCompleted` | Task being marked complete | Prevent completion; send feedback |

---

## Team Size & Task Sizing

**Team size guidelines:**
- Start with **3–5 teammates** for most workflows
- Token costs scale linearly with teammates
- Coordination overhead grows with team size
- Diminishing returns beyond a point

**Task sizing:**
- Too small → coordination overhead exceeds benefit
- Too large → long periods without check-ins, wasted effort
- Right size → self-contained unit producing a clear deliverable (a function, a test file, a review)

**Rule of thumb:** 5–6 tasks per teammate. If you have 15 independent tasks, 3 teammates is a good starting point.

---

## Shutdown

```text
Ask the researcher teammate to shut down
```

Teammate can approve (exits gracefully) or reject with explanation. Shared directories auto-cleaned on session exit.

---

## Best Use Cases

### Parallel Code Review
Split review criteria into independent domains so each gets thorough attention:
```text
Spawn three teammates to review PR #142:
- One: security implications
- One: performance impact
- One: test coverage
```

### Competing Hypotheses / Debugging
Force teammates to actively try to disprove each other's theories:
```text
Users report the app exits after one message instead of staying connected.
Spawn 5 agent teammates to investigate different hypotheses. Have them talk to
each other to try to disprove each other's theories, like a scientific debate.
Update the findings doc with whatever consensus emerges.
```

### Parallel Module Development
Each teammate owns separate files — no conflicts:
```text
Spawn 4 teammates to build these modules in parallel, each owning different files.
```

### Cross-layer Coordination
Frontend + backend + tests each owned by a separate teammate.

---

## Proven Patterns

1. **Name your teammates** in the spawn prompt for predictable references later.
2. **Assign file ownership** explicitly — two teammates editing the same file causes overwrites.
3. **Start with research/review tasks** if new to agent teams — clear boundaries, no code conflicts.
4. **Keep the lead steering** — check in, redirect, synthesize. Don't let the team run unattended for long.
5. **Tell lead to wait** if it starts doing work instead of delegating:
   ```text
   Wait for your teammates to complete their tasks before proceeding
   ```
6. **Tell lead to split finer** if task granularity is too coarse:
   ```text
   Split the work into smaller pieces before assigning
   ```

---

## Known Limitations

| Limitation | Workaround |
|---|---|
| `/resume` / `/rewind` don't restore in-process teammates | Tell lead to spawn new teammates after resuming |
| Task status can lag (teammate doesn't mark complete) | Check if work is done; update manually or tell lead to nudge |
| Shutdown can be slow | Wait for current tool call to finish |
| One team per session | N/A |
| No nested teams (teammates can't spawn teammates) | Only lead manages the team |
| Lead is fixed; can't transfer leadership | N/A |
| Split panes not supported in VS Code terminal, Windows Terminal, Ghostty | Use in-process mode |

---

## Troubleshooting

**Teammates not appearing:**
- In-process: check agent panel below prompt input (arrow keys to select, Enter to open)
- Idle rows hide after 30s — send a message by name to surface
- Check task was complex enough to warrant a team

**Too many permission prompts:** Pre-approve common ops in permission settings before spawning.

**Teammates stopping on errors:** Select in agent panel → Enter → give additional instructions or spawn replacement.

**Lead finishes before work is done:** Tell it to keep going / wait for teammates.

**Orphaned tmux sessions:**
```bash
tmux ls
tmux kill-session -t <session-name>
```

---

## Token Cost Awareness

Each teammate has its own context window. Token usage scales with active teammates. For routine or sequential tasks, prefer a single session. Agent teams pay off for research, parallel review, and genuinely independent module work.

See: https://code.claude.com/docs/en/costs#agent-team-token-costs

---

## Related

- [Subagents](https://code.claude.com/docs/en/sub-agents) — lightweight delegation within a session
- [Git Worktrees](https://code.claude.com/docs/en/worktrees) — manual parallel sessions without automated coordination
- [Hooks](https://code.claude.com/docs/en/hooks) — `TeammateIdle`, `TaskCreated`, `TaskCompleted`
- [Settings](https://code.claude.com/docs/en/settings) — `teammateMode`, `cleanupPeriodDays`
