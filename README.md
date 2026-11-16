# causeway

**Several AI coding agents, each in its own visible terminal session**

Claude Code, Codex and pi side by side on your own machine, with one dashboard,
memory that carries between sessions, and a safe place for API keys.

## Install

macOS and Linux:

```bash
curl -fsSL https://github.com/ddfourtwo/causeway-releases/releases/latest/download/install | bash
```

Windows, in a normal PowerShell window (not "Run as administrator"):

```powershell
irm https://github.com/ddfourtwo/causeway-releases/releases/latest/download/install.ps1 | iex
```

The binaries are prebuilt and checksum-verified, so there is nothing to compile.
You supply `git`, `curl` and `tar`; the installer fetches `tmux`, Node and the
agent programs if they are missing, and asks before it changes any of your own
files (`~/.claude`, `~/.codex`, `~/.pi`, shell startup files). If an install
stops part-way, run the same command again: it resumes.

When it finishes, the background services are running and your browser opens the
dashboard at <http://localhost:18089>.

To leave a piece out, put the option on the `bash` rather than on the `curl`:

```bash
curl -fsSL https://github.com/ddfourtwo/causeway-releases/releases/latest/download/install | CAUSEWAY_NO_MLX=1 bash
```

| option | what it leaves out |
|---|---|
| `CAUSEWAY_NO_MLX=1` | the local search model (about 700 MB) |
| `CAUSEWAY_NO_MEMORY=1` | memory, and the local Postgres that holds it |
| `CAUSEWAY_NO_AGENT_CONFIG=1` | changes nothing in `~/.claude`, `~/.codex`, `~/.pi` or your shell files |
| `CAUSEWAY_YES=1` | asks no questions, uses the recommended choices |

To pin a version, set `CAUSEWAY_VERSION` (for example `CAUSEWAY_VERSION=1.9.0`)
before running it.

## Your first session

1. **Sign in to one agent.** Run `claude` once and log in, or `codex` once, or add a
   provider for pi under dashboard → Settings → Agents. causeway cannot sign in for you.
2. **Create a session.** Run `causeway-cli` and press `n` for a session in the folder you
   are in, or `nw` for one in its own git worktree.
3. **Type to it.** The session appears in the dashboard. Open it, send a message, and
   watch the agent answer in the live pane.

## What you get

- **Every agent visible.** Each session is a real tmux session, so you can attach, watch
  and type into it directly. Nothing runs out of sight.
- **Isolation when you want it.** A session can run in its own git worktree on its own
  branch, without stashing or switching what you are working on.
- **Memory that carries.** What an agent learned in one session is recalled in the next
  one, per project.
- **Work that runs itself.** Schedules and routines fire while you are away and report
  back when they are done.
- **An assistant that remembers you.** One persistent session can learn how you decide,
  take your messages, and pick work back up while you are away.
- **Keys the agent cannot read.** The credential vault holds your API keys, scopes each one
  to named domains, and scrubs it out of anything returned.
- **A phone counts as a terminal.** Messages from Telegram, Signal, WhatsApp or Buzz reach
  a session, and its replies go back to you there.

## How it fits together

One daemon and one dashboard run on your machine. Every session is a tmux pane the daemon
owns, and the agent you chose is an ordinary CLI running inside that pane, which is why
you can watch it and why nothing is hidden behind a private protocol. Behind it: a Go
daemon on port 18088 that owns the sessions, a Svelte dashboard on 18089, an MCP server
that gives the agents their tools, a bash CLI, and the credential vault.

The [technical reference](docs/technical-reference.md) has the parts, the ports, where
everything lives on disk, every command, and what to do when a session will not start.

## Stay up to date

```bash
causeway-update --check   # what is new
causeway-update --apply   # update, then restart the services
causeway-cli doctor       # confirm every part is healthy
```

## Uninstall

macOS and Linux:

```bash
curl -fsSL https://github.com/ddfourtwo/causeway-releases/releases/latest/download/uninstall | bash
```

## License

MIT
