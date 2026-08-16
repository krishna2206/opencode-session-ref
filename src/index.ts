import type { Plugin } from "@opencode-ai/plugin";
import { sessionSearchTool } from "./tools/search.js";
import { createSessionListTool } from "./tools/list.js";
import { createSessionReadTool } from "./tools/read.js";
import { SESSION_REF_SYSTEM_PROMPT } from "./prompt.js";

export const SessionRefPlugin: Plugin = async ({ directory, worktree, client }) => {
  const currentDir = directory ?? worktree;

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(SESSION_REF_SYSTEM_PROMPT);
    },

    tool: {
      session_search: sessionSearchTool,
      session_list: createSessionListTool(currentDir),
      session_read: createSessionReadTool(client),
    },
  };
};

const pluginModule = {
  id: "opencode-session-ref",
  server: SessionRefPlugin,
};

export default pluginModule;
