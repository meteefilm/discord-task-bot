import type { ClickUpTask } from "../types/clickup.type.js";
import { formatDateTimeTH } from "../utils/date.util.js";

function isOpenTask(task: ClickUpTask): boolean {
    const status = task.status?.status?.toLowerCase() || "";

    return !["complete", "completed", "closed", "done"].includes(status);
}

export function buildTaskSummaryMessage(params: {
    title: string;
    tasks: ClickUpTask[];
}): string | null {
    const openTasks = params.tasks.filter(isOpenTask);

    if (!openTasks.length) {
        return null;
    }

    const lines = openTasks.slice(0, 30).map((task, index) => {
        const status = task.status?.status || "-";
        const priority = task.priority?.priority || "-";
        const due = formatDateTimeTH(task.due_date);
        const assignees = formatAssignees(task);

        return [
            `${index + 1}. **${task.name}**`,
            `   Status: ${status} | Priority: ${priority} | Assignee: ${assignees} | Due: ${due}`,
            task.url ? `   <${task.url}>` : "",
        ]
            .filter(Boolean)
            .join("\n");
    });

    const more =
        openTasks.length > 30
            ? `\n\nและอีก ${openTasks.length - 30} tasks...`
            : "";

    return `📋 **Daily ClickUp Summary: ${params.title}**\n\n${lines.join(
        "\n\n",
    )}${more}\n\n<!-- SG_SUMMARY -->`;
}

export function formatAssignees(task: ClickUpTask): string {
    if (!task.assignees || task.assignees.length === 0) {
        return "-";
    }

    return task.assignees
        .map((a) => a.username || a.email || a.id)
        .join(", ");
}
