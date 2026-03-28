import type { SessionConfig } from "@pi-gui/session-driver";
import type {
  RuntimeCommandRecord,
  RuntimeProviderRecord,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import { titleCase } from "./string-utils";

export type ComposerSlashCommandKind =
  | "runtime"
  | "model"
  | "thinking"
  | "status"
  | "session"
  | "reload"
  | "compact"
  | "name"
  | "login"
  | "logout"
  | "settings"
  | "scoped-models"
  | "new"
  | "resume"
  | "copy"
  | "export"
  | "share"
  | "hotkeys"
  | "changelog"
  | "fork"
  | "tree"
  | "quit"
  | "exit";

export interface ComposerSlashCommand {
  readonly id: string;
  readonly kind: ComposerSlashCommandKind;
  readonly command: string;
  readonly template: string;
  readonly title: string;
  readonly description: string;
  readonly submitMode?: "immediate" | "prefill" | "pick-option";
  readonly section: "runtime" | "host";
  readonly runtimeCommand?: RuntimeCommandRecord;
  readonly sourceLabel?: string;
}

export interface ComposerSlashCommandSection {
  readonly id: "runtime" | "host";
  readonly title?: string;
  readonly items: readonly ComposerSlashCommand[];
}

export interface ComposerSlashOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export interface ComposerModelOption extends ComposerSlashOption {
  readonly providerId: string;
  readonly modelId: string;
}

export interface ComposerProviderOption extends ComposerSlashOption {
  readonly providerId: string;
}

export type ParsedComposerCommand =
  | { type: "model"; provider: string; modelId: string }
  | { type: "thinking"; thinkingLevel: string }
  | { type: "status" }
  | { type: "session" }
  | { type: "reload" }
  | { type: "compact"; customInstructions?: string }
  | { type: "name"; title: string }
  | { type: "new" }
  | { type: "resume" }
  | { type: "copy" }
  | { type: "export"; filePath?: string }
  | { type: "share" }
  | { type: "hotkeys" }
  | { type: "changelog" }
  | { type: "fork" }
  | { type: "tree" }
  | { type: "quit" }
  | { type: "exit" };

const INCOMPLETE_COMMAND_MESSAGES: Readonly<Record<string, string>> = {
  "/compact": "Add optional instructions after /compact or send it directly from the slash menu.",
  "/login": "Choose a provider from the slash menu before sending /login.",
  "/logout": "Choose a connected provider from the slash menu before sending /logout.",
  "/model": "Choose a provider and model from the slash menu before sending /model.",
  "/name": "Add a thread title after /name.",
  "/scoped-models": "Open Scoped models from the slash menu or Settings.",
  "/settings": "Open Settings from the slash menu or Cmd+,.",
  "/thinking": "Choose a reasoning level from the slash menu before sending /thinking.",
} as const;

const HOST_ACTION_SLASH_COMMANDS: readonly ComposerSlashCommand[] = [
  {
    id: "host:model",
    kind: "model",
    command: "/model",
    template: "/model",
    title: "Model",
    description: "Choose the model for this session",
    submitMode: "pick-option",
    section: "host",
  },
  {
    id: "host:thinking",
    kind: "thinking",
    command: "/thinking",
    template: "/thinking",
    title: "Reasoning",
    description: "Set thinking level for this session",
    submitMode: "pick-option",
    section: "host",
  },
  {
    id: "host:status",
    kind: "status",
    command: "/status",
    template: "/status",
    title: "Status",
    description: "Show current session overrides in the timeline",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "host:login",
    kind: "login",
    command: "/login",
    template: "/login",
    title: "Login",
    description: "Authenticate a provider for this workspace",
    submitMode: "pick-option",
    section: "host",
  },
  {
    id: "host:logout",
    kind: "logout",
    command: "/logout",
    template: "/logout",
    title: "Logout",
    description: "Remove a provider login from this workspace",
    submitMode: "pick-option",
    section: "host",
  },
  {
    id: "host:settings",
    kind: "settings",
    command: "/settings",
    template: "/settings",
    title: "Settings",
    description: "Open model, skill, and notification settings",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "host:scoped-models",
    kind: "scoped-models",
    command: "/scoped-models",
    template: "/scoped-models",
    title: "Scoped models",
    description: "Manage the quick-cycle model shortlist",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "host:session",
    kind: "session",
    command: "/session",
    template: "/session",
    title: "Session",
    description: "Show current session details in the timeline",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "host:name",
    kind: "name",
    command: "/name",
    template: "/name New thread title",
    title: "Rename",
    description: "Rename the current session",
    submitMode: "prefill",
    section: "host",
  },
  {
    id: "host:compact",
    kind: "compact",
    command: "/compact",
    template: "/compact",
    title: "Compact",
    description: "Compact session context now",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "host:reload",
    kind: "reload",
    command: "/reload",
    template: "/reload",
    title: "Reload",
    description: "Reload prompts, skills, and session resources",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "new",
    kind: "new",
    command: "/new",
    template: "/new",
    title: "New",
    description: "Start a new session",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "resume",
    kind: "resume",
    command: "/resume",
    template: "/resume",
    title: "Resume",
    description: "Pick from previous sessions",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "copy",
    kind: "copy",
    command: "/copy",
    template: "/copy",
    title: "Copy",
    description: "Copy last assistant message to clipboard",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "export",
    kind: "export",
    command: "/export",
    template: "/export",
    title: "Export",
    description: "Export session to HTML file",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "share",
    kind: "share",
    command: "/share",
    template: "/share",
    title: "Share",
    description: "Copy session transcript to clipboard as markdown",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "hotkeys",
    kind: "hotkeys",
    command: "/hotkeys",
    template: "/hotkeys",
    title: "Hotkeys",
    description: "Show all keyboard shortcuts",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "changelog",
    kind: "changelog",
    command: "/changelog",
    template: "/changelog",
    title: "Changelog",
    description: "Display version history",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "fork",
    kind: "fork",
    command: "/fork",
    template: "/fork",
    title: "Fork",
    description: "Create a new session from the current point",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "tree",
    kind: "tree",
    command: "/tree",
    template: "/tree",
    title: "Tree",
    description: "Show session tree and branches",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "quit",
    kind: "quit",
    command: "/quit",
    template: "/quit",
    title: "Quit",
    description: "Stop the current running session",
    submitMode: "immediate",
    section: "host",
  },
  {
    id: "exit",
    kind: "exit",
    command: "/exit",
    template: "/exit",
    title: "Exit",
    description: "Stop current run and close the application",
    submitMode: "immediate",
    section: "host",
  },
] as const;

export const THINKING_OPTIONS: readonly ComposerSlashOption[] = [
  {
    value: "low",
    label: "Low",
    description: "Fast responses with lighter reasoning",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balances speed and reasoning depth for everyday tasks",
  },
  {
    value: "high",
    label: "High",
    description: "Greater reasoning depth for complex problems",
  },
  {
    value: "xhigh",
    label: "Extra High",
    description: "Extra high reasoning depth for complex problems",
  },
] as const;

export function buildSlashCommandSections(
  query: string,
  runtime: RuntimeSnapshot | undefined,
  sessionCommands: readonly RuntimeCommandRecord[],
): readonly ComposerSlashCommandSection[] {
  const normalizedQuery = query.trim().toLowerCase();
  const availableRuntimeCommands = resolveRuntimeCommands(runtime, sessionCommands);
  const runtimeMatches = availableRuntimeCommands
    .map<ComposerSlashCommand>((command) => ({
      id: `runtime:${command.source}:${command.name}`,
      kind: "runtime",
      command: `/${command.name}`,
      template: `/${command.name} `,
      title: formatRuntimeCommandTitle(command),
      description: formatRuntimeCommandDescription(command),
      submitMode: "prefill",
      section: "runtime",
      runtimeCommand: command,
      sourceLabel: formatRuntimeSourceLabel(command),
    }))
    .filter((command) => matchesCommand(command, normalizedQuery));
  const hostMatches = HOST_ACTION_SLASH_COMMANDS.filter((command) => matchesCommand(command, normalizedQuery));

  const sections: ComposerSlashCommandSection[] = [
    {
      id: "runtime",
      title: runtimeMatches.length > 0 ? "Runtime Commands" : undefined,
      items: runtimeMatches,
    },
    {
      id: "host",
      title: hostMatches.length > 0 ? "Host Actions" : undefined,
      items: hostMatches,
    },
  ];

  return sections.filter((section) => section.items.length > 0);
}

export function resolveRuntimeCommands(
  runtime: RuntimeSnapshot | undefined,
  sessionCommands: readonly RuntimeCommandRecord[],
): readonly RuntimeCommandRecord[] {
  if (!runtime) {
    return sessionCommands;
  }

  const baseCommands = runtime.settings.enableSkillCommands
    ? sessionCommands
    : sessionCommands.filter((command) => command.source !== "skill");
  if (!runtime.settings.enableSkillCommands) {
    return baseCommands;
  }

  const merged = [...baseCommands];
  const seenNames = new Set(baseCommands.map((command) => command.name));
  for (const skill of runtime.skills) {
    if (!skill.enabled) {
      continue;
    }

    const commandName = normalizeRuntimeCommandName(skill.slashCommand);
    if (seenNames.has(commandName)) {
      continue;
    }

    seenNames.add(commandName);
    merged.push({
      name: commandName,
      description: skill.description,
      source: "skill",
      sourceInfo: {
        path: skill.filePath,
        source: skill.source,
        scope: skill.filePath.startsWith(runtime.workspace.path) ? "project" : "user",
        origin: "top-level",
        baseDir: skill.baseDir,
      },
    });
  }

  return merged;
}

export function hasRuntimeSlashCommand(
  text: string,
  runtime: RuntimeSnapshot | undefined,
  sessionCommands: readonly RuntimeCommandRecord[],
): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }

  const spaceIndex = trimmed.indexOf(" ");
  const commandName = normalizeRuntimeCommandName(spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex));
  return resolveRuntimeCommands(runtime, sessionCommands).some((command) => command.name === commandName);
}

function normalizeRuntimeCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

export function flattenSlashSections(
  sections: readonly ComposerSlashCommandSection[],
): readonly ComposerSlashCommand[] {
  return sections.flatMap((section) => section.items);
}

export function buildProviderOptions(
  providers: readonly RuntimeProviderRecord[],
  filter: (provider: RuntimeProviderRecord) => boolean = () => true,
): readonly ComposerProviderOption[] {
  return providers
    .filter(filter)
    .sort(compareProviders)
    .map((provider) => ({
      value: provider.id,
      label: provider.name,
      description: describeProvider(provider),
      providerId: provider.id,
    }));
}

export function buildModelOptions(
  runtime: RuntimeSnapshot | undefined,
): readonly ComposerModelOption[] {
  if (!runtime) {
    return [];
  }

  return [...runtime.models]
    .sort((left: RuntimeSnapshot["models"][number], right: RuntimeSnapshot["models"][number]) => {
      const providerCompare =
        providerRankForId(runtime.providers, left.providerId) - providerRankForId(runtime.providers, right.providerId);
      if (providerCompare !== 0) {
        return providerCompare;
      }
      return `${left.providerName} ${left.label}`.localeCompare(`${right.providerName} ${right.label}`);
    })
    .map((model: RuntimeSnapshot["models"][number]) => ({
      value: model.modelId,
      label: `${model.providerName} · ${model.label}`,
      description: `${model.modelId}${model.available ? "" : " · unavailable"}`,
      providerId: model.providerId,
      modelId: model.modelId,
    }));
}

export function slashOptionsForCommand(
  command: ComposerSlashCommand | undefined,
  runtime?: RuntimeSnapshot,
): readonly ComposerSlashOption[] {
  if (!command) {
    return [];
  }

  if (command.kind === "thinking") {
    return THINKING_OPTIONS;
  }
  if (command.kind === "model") {
    return buildModelOptions(runtime);
  }
  if (command.kind === "login") {
    return buildProviderOptions(runtime?.providers ?? [], (provider) => provider.oauthSupported);
  }
  if (command.kind === "logout") {
    return buildProviderOptions(runtime?.providers ?? [], (provider) => provider.hasAuth);
  }

  return [];
}

function matchesCommand(command: ComposerSlashCommand, normalizedQuery: string): boolean {
  if (!normalizedQuery.startsWith("/")) {
    return false;
  }

  if (normalizedQuery === "/") {
    return true;
  }

  return [command.command, command.title, command.description, command.sourceLabel ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function describeProvider(provider: RuntimeProviderRecord): string {
  if (provider.oauthSupported) {
    return provider.hasAuth ? "OAuth connected" : "OAuth available";
  }
  if (provider.hasAuth) {
    return "Configured";
  }
  return provider.authType === "api_key" ? "Needs API key" : "Available";
}

function compareProviders(left: RuntimeProviderRecord, right: RuntimeProviderRecord): number {
  const leftRank = providerRank(left);
  const rightRank = providerRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.name.localeCompare(right.name);
}

function providerRank(provider: RuntimeProviderRecord): number {
  if (provider.hasAuth) {
    return 0;
  }
  if (provider.id === "openai-codex" || provider.id === "anthropic") {
    return 1;
  }
  if (provider.oauthSupported) {
    return 2;
  }
  return 3;
}

function providerRankForId(
  providers: readonly RuntimeProviderRecord[],
  providerId: string,
): number {
  const provider = providers.find((entry) => entry.id === providerId);
  return provider ? providerRank(provider) : 99;
}

function summarizeSkillDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "Reusable workflow";
  }

  const firstSentence = trimmed.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? trimmed;
  return firstSentence.length > 96 ? `${firstSentence.slice(0, 93).trimEnd()}...` : firstSentence;
}

function formatRuntimeCommandTitle(command: RuntimeCommandRecord): string {
  if (command.source === "skill" && command.name.startsWith("skill:")) {
    return titleCase(command.name.slice("skill:".length));
  }
  return titleCase(command.name.replace(/[:_-]+/g, " "));
}

function formatRuntimeCommandDescription(command: RuntimeCommandRecord): string {
  if (command.description?.trim()) {
    return command.description.trim();
  }
  if (command.source === "prompt") {
    return "Prompt template";
  }
  if (command.source === "skill") {
    return "Skill command";
  }
  return "Extension command";
}

function formatRuntimeSourceLabel(command: RuntimeCommandRecord): string {
  if (command.source === "skill") {
    return "Skill";
  }
  if (command.source === "prompt") {
    return "Prompt";
  }
  return command.sourceInfo.source.replace(/^extension:/, "");
}

export function formatSessionConfigStatus(config?: SessionConfig): string {
  const parts = [
    config?.provider && config?.modelId ? `Model ${config.provider}:${config.modelId}` : undefined,
    config?.thinkingLevel ? `Thinking ${config.thinkingLevel}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "No session overrides set";
}

export function parseComposerCommand(value: string): ParsedComposerCommand | undefined {
  const trimmed = value.trim();
  if (trimmed === "/status") {
    return { type: "status" };
  }
  if (trimmed === "/session") {
    return { type: "session" };
  }
  if (trimmed === "/reload") {
    return { type: "reload" };
  }
  if (trimmed === "/new") {
    return { type: "new" };
  }
  if (trimmed === "/resume") {
    return { type: "resume" };
  }
  if (trimmed === "/copy") {
    return { type: "copy" };
  }
  if (trimmed === "/share") {
    return { type: "share" };
  }
  if (trimmed === "/hotkeys") {
    return { type: "hotkeys" };
  }
  if (trimmed === "/changelog") {
    return { type: "changelog" };
  }
  if (trimmed === "/fork") {
    return { type: "fork" };
  }
  if (trimmed === "/tree") {
    return { type: "tree" };
  }
  if (trimmed === "/quit") {
    return { type: "quit" };
  }
  if (trimmed === "/exit") {
    return { type: "exit" };
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  if (command === "/compact") {
    return { type: "compact", customInstructions: rest.join(" ").trim() || undefined };
  }
  if (command === "/export") {
    return { type: "export", filePath: rest.join(" ").trim() || undefined };
  }
  if (command === "/name") {
    const title = rest.join(" ").trim();
    return title ? { type: "name", title } : undefined;
  }
  if (command === "/thinking") {
    const thinkingLevel = rest[0]?.trim();
    if (!thinkingLevel) {
      return undefined;
    }
    return { type: "thinking", thinkingLevel };
  }

  if (command === "/model") {
    if (rest.length >= 2) {
      return {
        type: "model",
        provider: rest[0] ?? "",
        modelId: rest.slice(1).join(" "),
      };
    }

    const combined = rest[0];
    if (combined?.includes(":")) {
      const [provider, ...modelParts] = combined.split(":");
      const modelId = modelParts.join(":");
      if (provider && modelId) {
        return { type: "model", provider, modelId };
      }
    }
  }

  return undefined;
}

export function incompleteComposerCommandMessage(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }

  const [command] = trimmed.split(/\s+/);
  return INCOMPLETE_COMMAND_MESSAGES[command as keyof typeof INCOMPLETE_COMMAND_MESSAGES];
}

export function isExactSlashCommand(query: string, command: ComposerSlashCommand): boolean {
  return query.trim().toLowerCase() === command.command.toLowerCase();
}
