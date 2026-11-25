// Causeway agents for Buzz 1.0, as an installed plugin: Create agent →
// Harness → Causeway. Each agent runs one `causeway-acp --host buzz1` in its
// project folder, and each conversation it is in is one ACP session there,
// which Causeway keeps as one continuing session across app restarts.
//
// Built only on the plugin API (`agents`, its `harness` kit, `host`), so a
// Buzz update that changes its internals leaves it working; one that changes
// the kit breaks only this file. Plain JS with no build step: the plugin API
// loads one self-contained module and gives React as `ctx.react`.
//
// The session has no Buzz tools yet: its final text is posted as its reply.

export const inject = ["agents", "host", "react"];

const TYPE_ID = "causeway";
const PROCESS_ID = "causeway";
const HOST_NAME = "buzz1";
const STORE = "causeway.agents";
/** A turn's run returns once Causeway has it; this bounds the whole turn. */
const TURN_MS = 30 * 60_000;
const REQUEST_MS = 60_000;
/** Launches per agent per window before its type refuses to start again. */
const LAUNCH_CAP = 5;
const LAUNCH_WINDOW_MS = 10 * 60_000;
const OTHER = "\u0000other";

export const DEFAULT_CONFIG = Object.freeze({
  workspace: "",
  instructions: "",
  scope: "thread",
});
export const NO_WORKSPACE =
  "This Causeway agent has no project folder. Choose one in its Settings.";
const MISSING =
  "causeway-acp was not found (Buzz searches ~/.local/bin first). Install or update Causeway on this computer, then try again.";

export function config(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    workspace: typeof value.workspace === "string" ? value.workspace : "",
    instructions:
      typeof value.instructions === "string" ? value.instructions : "",
    scope: value.scope === "channel" ? "channel" : "thread",
  };
}

export const validWorkspace = (path) =>
  /^(~(\/|$)|\/)/.test(String(path ?? "").trim());

const message = (error) =>
  error instanceof Error ? error.message : String(error);

/** One `causeway-acp` process: JSON-RPC over its stdin and stdout. */
export class Bridge {
  constructor(process) {
    this.process = process;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.buffer = "";
    this.closed = false;
    process.exited.then((code) => this.fail(`causeway-acp exited (${code})`));
  }

  static async start(host, project) {
    let bridge;
    // Output that arrives before the bridge exists is kept for it.
    const early = [];
    const process = await host
      .spawn(PROCESS_ID, {
        args: ["--project", project, "--host", HOST_NAME],
        cwd: project,
        onStdout: (data) => (bridge ? bridge.read(data) : early.push(data)),
      })
      .catch((error) => {
        throw new Error(/not found|No such file/i.test(message(error)) ? MISSING : message(error));
      });
    bridge = new Bridge(process);
    for (const data of early) bridge.read(data);
    await bridge.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    return bridge;
  }

  read(data) {
    this.buffer += data;
    let end = this.buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      end = this.buffer.indexOf("\n");
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.receive(msg);
    }
  }

  receive(msg) {
    if (msg.method) {
      if (msg.method === "session/update") {
        const id = msg.params?.sessionId;
        this.listeners.get(id)?.(msg.params?.update ?? {});
      }
      // A request this client does not serve must still be answered.
      if (msg.id !== undefined)
        void this.write({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        });
      return;
    }
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error(msg.error.message ?? "causeway-acp failed"));
    else waiter.resolve(msg.result ?? {});
  }

  write(msg) {
    return this.process.write(`${JSON.stringify(msg)}\n`);
  }

  request(method, params, timeout = REQUEST_MS) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`causeway-acp did not answer ${method}`));
          }, timeout)
        : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /** Runs one turn and resolves with the text the session wrote. */
  async prompt(sessionId, text) {
    let reply = "";
    this.listeners.set(sessionId, (update) => {
      if (update.sessionUpdate === "agent_message_chunk")
        reply += update.content?.text ?? "";
    });
    try {
      await this.request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text }] },
        TURN_MS,
      );
      return reply;
    } finally {
      this.listeners.delete(sessionId);
    }
  }

  fail(reason) {
    if (this.closed) return;
    this.closed = reason;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.pending.clear();
  }

  kill() {
    this.fail("causeway-acp was stopped");
    return this.process.kill().catch(() => undefined);
  }
}

/** Turns Buzz deliveries into Causeway turns. */
export class Runtime {
  constructor(host, kit, storage) {
    this.host = host;
    this.kit = kit;
    this.storage = storage;
    /** agent key → { project, bridge: Promise<Bridge>, sessions, launches } */
    this.agents = new Map();
  }

  cursorKey(agent, conversation) {
    return `${STORE}:${agent.key}:${conversation.key}`;
  }
  cursor(agent, conversation) {
    return this.storage?.getItem(this.cursorKey(agent, conversation)) ?? undefined;
  }
  saveCursor(agent, conversation, cursor) {
    try {
      this.storage?.setItem(this.cursorKey(agent, conversation), cursor);
    } catch {
      // A full store only means the next turn shows the conversation again.
    }
  }

  /** The agent's `causeway-acp`, started on first use in `project`, and
   * restarted when the project changes. Lazy, one launch in flight, and
   * capped, so a broken install cannot spawn in a loop. */
  async entry(agent, project) {
    let entry = this.agents.get(agent.key);
    if (entry && entry.project !== project) {
      this.agents.delete(agent.key);
      void entry.bridge.then((bridge) => bridge.kill(), () => undefined);
      entry = { launches: entry.launches };
    }
    if (entry?.bridge) {
      const bridge = await entry.bridge;
      if (!bridge.closed) return { entry, bridge };
    }
    const now = Date.now();
    const launches = (entry?.launches ?? []).filter(
      (at) => now - at < LAUNCH_WINDOW_MS,
    );
    if (launches.length >= LAUNCH_CAP)
      throw new Error(
        `causeway-acp failed to start ${LAUNCH_CAP} times in 10 minutes; Buzz stopped trying. Check Causeway on this computer, then restart Buzz.`,
      );
    launches.push(now);
    entry = { project, launches, sessions: new Map() };
    entry.bridge = Bridge.start(this.host, project);
    this.agents.set(agent.key, entry);
    entry.bridge.catch(() => {
      if (this.agents.get(agent.key) === entry) entry.bridge = undefined;
    });
    return { entry, bridge: await entry.bridge };
  }

  /** The ACP session for `conversation`, opened once per process. */
  session(entry, bridge, agent, conversation) {
    let session = entry.sessions.get(conversation.key);
    if (session?.bridge === bridge) return session;
    const channelName = conversation.where.replace(/^#/, "");
    session = {
      bridge,
      prompted: false,
      tail: Promise.resolve(),
      id: bridge
        .request("session/new", {
          cwd: entry.project,
          mcpServers: [],
          _meta: {
            causeway: {
              conversation: conversation.key,
              agent: agent.pubkey,
              ...(channelName ? { channelName } : {}),
            },
          },
        })
        .then((opened) => opened.sessionId),
    };
    session.id.catch(() => entry.sessions.delete(conversation.key));
    entry.sessions.set(conversation.key, session);
    return session;
  }

  async run(delivery) {
    const cfg = config(delivery.config);
    const { agent } = delivery;
    const conversation = await this.kit.conversation(delivery, cfg.scope);
    if (!conversation) return;
    delivery.acknowledged?.();
    if (!validWorkspace(cfg.workspace)) {
      await this.kit.reply(agent, conversation, NO_WORKSPACE, {
        notifyOwner: true,
      });
      return;
    }
    let stop;
    delivery.interruptible?.(() => stop?.() ?? Promise.resolve());
    const done = (async () => {
      const project = await this.host.resolveDirectory(cfg.workspace.trim());
      const { entry, bridge } = await this.entry(agent, project);
      const session = this.session(entry, bridge, agent, conversation);
      // One turn at a time in a conversation, in the order they came.
      const turn = session.tail.then(async () => {
        const sessionId = await session.id;
        stop = () =>
          bridge.request("session/cancel", { sessionId }).then(() => undefined);
        if (!delivery.current()) return { ok: true };
        const prompt = await this.kit.turnPrompt(delivery, conversation, {
          cursor: this.cursor(agent, conversation),
        });
        let text = prompt.text;
        // Causeway takes the system prompt with a session's first prompt.
        if (!session.prompted) {
          const system = await this.kit.systemPrompt(delivery, {
            scope: cfg.scope,
            cwd: project,
            instructions: cfg.instructions,
            tools: false,
            conversation,
          });
          text = `${system}\n\n${text}`;
        }
        if (!delivery.current()) {
          prompt.restore();
          return { ok: true };
        }
        delivery.accepted?.();
        session.prompted = true;
        const reply = await bridge.prompt(sessionId, text);
        this.saveCursor(agent, conversation, prompt.cursor);
        if (reply.trim()) await this.kit.reply(agent, conversation, reply.trim());
        return { ok: true };
      });
      session.tail = turn.catch(() => undefined);
      return turn;
    })().catch(async (error) => {
      const reason = message(error);
      await this.kit
        .reply(agent, conversation, `Causeway could not answer: ${reason}`, {
          notifyOwner: true,
        })
        .catch(() => undefined);
      return { ok: false, error: reason };
    });
    delivery.workingUntil(done);
  }

  async retire(key) {
    const entry = this.agents.get(key);
    this.agents.delete(key);
    const bridge = await entry?.bridge?.catch(() => undefined);
    await bridge?.kill();
  }

  dispose() {
    for (const key of [...this.agents.keys()]) void this.retire(key);
  }
}

/** Causeway's registered projects, read from a `causeway-acp` started in the
 * home folder; empty when this Causeway cannot list them. */
export function projectLister(host) {
  let listing;
  let failedAt = 0;
  return () => {
    if (listing) return listing;
    if (Date.now() - failedAt < 60_000) return Promise.resolve([]);
    listing = (async () => {
      const home = await host.resolveDirectory("~");
      const bridge = await Bridge.start(host, home);
      try {
        const { projects } = await bridge.request("_causeway/projects", {});
        return Array.isArray(projects)
          ? projects.filter(
              (p) => typeof p?.name === "string" && typeof p?.path === "string",
            )
          : [];
      } finally {
        void bridge.kill();
      }
    })();
    listing.catch(() => {
      listing = undefined;
      failedAt = Date.now();
    });
    return listing.catch(() => []);
  };
}

function views(React, ui, projects) {
  const h = React.createElement;
  const field = (label, description, child) =>
    ui?.Field
      ? h(ui.Field, { label, description }, child)
      : h("label", { style: { display: "grid", gap: "var(--space-2)" } }, label, child);
  const input = (value, onChange, disabled, placeholder) =>
    ui?.Input
      ? h(ui.Input, { value, onValueChange: onChange, disabled, placeholder })
      : h("input", {
          value,
          disabled,
          placeholder,
          onChange: (event) => onChange(event.target.value),
        });
  const select = (value, options, onChange, disabled) =>
    h(
      "select",
      {
        value,
        disabled,
        onChange: (event) => onChange(event.target.value),
        style: { width: "100%" },
      },
      options.map((option) =>
        h("option", { key: option.value, value: option.value }, option.label),
      ),
    );

  function useProjects() {
    const [listed, setListed] = React.useState();
    React.useEffect(() => {
      let live = true;
      projects().then((found) => live && setListed(found));
      return () => {
        live = false;
      };
    }, []);
    return listed;
  }

  function ProjectField({ value, onChange, disabled }) {
    const listed = useProjects();
    const [other, setOther] = React.useState(false);
    const known = listed?.some((p) => p.path === value);
    const typed = !listed?.length || other || (!!value && !known);
    const folder = field(
      "Project folder",
      "An absolute path, or ~/ for your home folder.",
      input(value, onChange, disabled, "~/github/my-project"),
    );
    if (!listed?.length) return folder;
    return h(
      React.Fragment,
      null,
      field(
        "Project",
        "The Causeway project this agent works in and keeps its memory for.",
        select(
          typed ? OTHER : value,
          [
            ...(value || typed ? [] : [{ value: "", label: "Choose a project…" }]),
            ...listed.map((p) => ({ value: p.path, label: p.name })),
            { value: OTHER, label: "Other folder…" },
          ],
          (picked) => {
            setOther(picked === OTHER);
            onChange(picked === OTHER ? "" : picked);
          },
          disabled,
        ),
      ),
      typed ? folder : null,
    );
  }

  const instructionsField = (value, onChange, disabled) =>
    field(
      "Instructions",
      "Added to Causeway's own instructions for this agent.",
      h("textarea", {
        value,
        disabled,
        rows: 5,
        style: { width: "100%" },
        onChange: (event) => onChange(event.target.value),
      }),
    );

  function Create({ config: raw, onChange, disabled }) {
    const current = config(raw);
    return h(
      "div",
      { style: { display: "grid", gap: "var(--space-2)" } },
      h(ProjectField, {
        value: current.workspace,
        disabled,
        onChange: (workspace) => onChange({ ...current, workspace }),
      }),
      instructionsField(current.instructions, (instructions) =>
        onChange({ ...current, instructions }), disabled),
    );
  }

  function Settings({ agent, save }) {
    const saved = config(agent.config);
    const [draft, setDraft] = React.useState(saved);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const changed = JSON.stringify(draft) !== JSON.stringify(saved);
    const valid = validWorkspace(draft.workspace);
    const submit = async (event) => {
      event.preventDefault();
      setSaving(true);
      setError("");
      try {
        await save({ ...draft, workspace: draft.workspace.trim() });
      } catch (reason) {
        setError(message(reason));
      } finally {
        setSaving(false);
      }
    };
    const button = { type: "submit", disabled: !changed || !valid || saving };
    return h(
      "form",
      { onSubmit: submit, style: { display: "grid", gap: "var(--space-2)" } },
      error ? h("p", { role: "alert" }, error) : null,
      h(ProjectField, {
        value: draft.workspace,
        onChange: (workspace) => setDraft({ ...draft, workspace }),
      }),
      field(
        "Conversations",
        null,
        select(
          draft.scope,
          [
            { value: "thread", label: "One conversation per thread" },
            { value: "channel", label: "One conversation per channel" },
          ],
          (scope) => setDraft({ ...draft, scope }),
        ),
      ),
      instructionsField(draft.instructions, (instructions) =>
        setDraft({ ...draft, instructions })),
      ui?.Button
        ? h(ui.Button, { ...button, variant: "prominent", loading: saving }, "Save")
        : h("button", button, "Save"),
    );
  }

  return { Create, Settings };
}

export function apply(ctx) {
  const { agents, host } = ctx;
  // Only the desktop app can start `causeway-acp`.
  if (!host.spawn || !host.resolveDirectory) return;
  const runtime = new Runtime(host, agents.harness, globalThis.localStorage);
  ctx.effect(() => () => runtime.dispose());
  const { Create, Settings } = views(
    ctx.react,
    ctx.reflect?.get?.("ui"),
    projectLister(host),
  );
  agents.register({
    id: TYPE_ID,
    title: "Causeway",
    description:
      "Causeway on this computer: memory, routing and clearance across sessions. Each conversation it is in is one continuing Causeway session.",
    defaults: () => ({ config: DEFAULT_CONFIG }),
    summary: (agent) => {
      const { workspace } = config(agent.config);
      return workspace ? `Causeway · ${workspace.split("/").pop()}` : "Causeway";
    },
    Create,
    tabs: [
      {
        id: "settings",
        title: "Settings",
        role: "settings",
        component: Settings,
      },
    ],
    run: (delivery) => runtime.run(delivery),
    retire: (key) => runtime.retire(key),
    timeoutMs: TURN_MS,
  });
}
