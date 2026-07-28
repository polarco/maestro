import type { PlanSpec } from "@maestro/contracts";

function list(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- Nenhum";
}

function escapeInline(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ").trim();
}

export function planToMarkdown(plan: PlanSpec): string {
  const tasks = plan.tasks
    .map((task, index) => {
      const dependencies = task.dependencies.length > 0 ? task.dependencies.join(", ") : "nenhuma";
      const validations =
        task.validationCommands.length > 0
          ? task.validationCommands
              .map(
                (command) =>
                  `  - \`${escapeInline(command.executable)} ${command.args.map(escapeInline).join(" ")}\``,
              )
              .join("\n")
          : "  - Nenhuma";
      return [
        `### ${index + 1}. ${task.title}`,
        "",
        task.description,
        "",
        `- **Função:** ${task.role}`,
        `- **Dependências:** ${dependencies}`,
        `- **Modelo:** ${task.model.providerId}/${task.model.modelId}`,
        `- **Workspace:** ${task.workspaceStrategy}`,
        "- **Critérios:**",
        task.successCriteria.map((criterion) => `  - ${criterion}`).join("\n"),
        "- **Validação:**",
        validations,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `# Plano v${plan.version}`,
    "",
    plan.summary,
    "",
    "## Pressupostos",
    "",
    list(plan.assumptions),
    "",
    "## Riscos",
    "",
    list(plan.risks),
    "",
    "## Critérios de sucesso",
    "",
    list(plan.successCriteria),
    "",
    "## Tarefas",
    "",
    tasks,
    "",
  ].join("\n");
}
