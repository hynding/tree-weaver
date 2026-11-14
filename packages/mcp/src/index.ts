/**
 * The Tree Weaver MCP server. Run it with `npx @tree-weaver/mcp`, or embed it:
 *
 * ```ts
 * import { createServer } from '@tree-weaver/mcp';
 * await createServer({ root: './site' }).connect(transport);
 * ```
 */
export { createServer, INSTRUCTIONS, type ServerOptions } from './server';
export { Tools, ToolError, outlineText, type ToolOutput, type Source } from './tools';
export { Workspace } from './workspace';
