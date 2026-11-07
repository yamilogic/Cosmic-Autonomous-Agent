/**
 * Empty seam for future project tools (MCP, write actions). Nothing is
 * registered in this build: chat is read-only and has no tool access.
 */
export interface ProjectTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  schema: unknown
  run(input: TInput): Promise<TOutput>
}

export class ProjectToolRegistry {
  private readonly tools = new Map<string, ProjectTool>()

  register(tool: ProjectTool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ProjectTool | undefined {
    return this.tools.get(name)
  }

  list(): ProjectTool[] {
    return [...this.tools.values()]
  }
}

export const projectToolRegistry = new ProjectToolRegistry()
