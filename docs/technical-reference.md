# causeway: the technical reference

What each part is, where it lives on your machine, and what to type. For what
causeway is and how to install it, see the [README](../README.md).

## The parts

| Part | What it does | Where |
|---|---|---|
| Daemon | owns sessions, worktrees, schedules and the API | `http://127.0.0.1:18088` |
| Dashboard | the web UI for sessions, chat, memory and settings | `http://127.0.0.1:18089` |
| CLI | `causeway-cli`, the menu and the admin commands | on your `PATH` |
| MCP server | the tools an agent session gets (sessions, routes, tasks, memory, schedules, contacts) | started per session |
| Credential vault | holds API keys, scopes them per domain, scrubs them from responses | `credential-proxy` |

An agent session is a tmux session owned by the daemon. The dashboard, the CLI and
your phone are three windows onto the same objects.

## Backends

causeway wraps a coding agent CLI; it does not run a model itself.

| Backend | Name in settings | Sign-in |
|---|---|---|
| Claude Code | `claude-code` | run `claude` once and log in |
| OpenAI Codex | `codex` | run `codex` once and log in |
| pi | `pi` | dashboard → Settings → Agents, add a provider and a key |

All three get the same session surface: injected project instructions, memory
recall, skills, MCP tools, sub-agent spawning and git worktrees. Which hook each
backend uses to deliver that differs, and is the one thing that behaves
differently between them.

## Where things live

| Path | Contents |
|---|---|
| `~/.config/causeway/` | `config.yaml` (backends, models, providers) and `instances.yaml` (separate instances, each with its own port) |
| `~/.local/share/causeway/sessions.json` | the session registry |
| `~/.local/share/causeway/worktrees/` | git worktrees created for isolated sessions |
| `~/.local/share/causeway/logs/` | daemon, dashboard, model-proxy and service logs |
| `~/.local/share/causeway/src/` | a source install's own copy of the repository |

Change settings in the dashboard, not by editing `config.yaml`: the daemon does
not watch the files, so a hand edit waits for the next restart.

## Commands

```bash
causeway-cli                 # the menu: n = new session, nw = new worktree session
causeway-cli setup           # install, repair or resume; --help for the flags
causeway-cli doctor          # check every part of the install
causeway-cli start|stop|restart   # the services (needed after a reboot where no service manager runs)
causeway-cli assistant on|off     # the one long-lived assistant session
causeway-update --check      # what is new
causeway-update --apply      # update and restart
```

Inside a session, the agent's tools cover the same ground: `session` for
spawning and driving sessions, `schedule` for future work, `memory` for the
project's knowledge graph, `routes` and `send_message` for reaching you.

## Two things worth knowing

**Memory is per project and local.** Recall runs against a Postgres store the
installer sets up, keyed on the repository's git remote, so a checkout that moves
keeps its history. Memory never leaves your machine unless you point it at a
shared store.

**Sessions survive the daemon.** Each session is a tmux session, so a daemon
restart reattaches to it instead of losing it, and you can attach with tmux at
any time to watch or type.

## Troubleshooting

- `causeway-cli doctor` names the broken part and what to do about it.
- A session that starts and sits at a login prompt means the agent CLI is not
  signed in: run `claude` or `codex` once, or add a provider for pi.
- If an install stops part-way, run the same one-liner again. It resumes.
- Logs are in `~/.local/share/causeway/logs/`; `daemon.log` is the one to read
  first.
- Windows: services are per-user Scheduled Tasks, and the installer refuses to
  run from an elevated prompt. Use a normal PowerShell window.
