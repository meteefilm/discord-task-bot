import type { ClickUpTask } from "../types/clickup.type.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function calculateDueDateByPriority(task: ClickUpTask): number | null {
    const priority = task.priority?.priority?.toLowerCase();

    if (!priority) return null;

    const now = Date.now();

    switch (priority) {
        case "urgent":
            return now + 4 * HOUR;

        case "high":
            return now + 1 * DAY;

        case "normal":
            return now + 3 * DAY;

        case "low":
            return now + 7 * DAY;

        default:
            return null;
    }
}

export function shouldUpdateDueDate(task: ClickUpTask): boolean {
    if (task.due_date) return false;
    return Boolean(calculateDueDateByPriority(task));
}