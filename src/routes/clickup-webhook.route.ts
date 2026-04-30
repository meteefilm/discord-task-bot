import { Router } from "express";
import type { ClickUpWebhookPayload } from "../types/clickup.type.js";
import { client } from "../bot/client.js";
import {
    getTask,
    updateTaskDueDate,
    updateTaskName,
} from "../services/clickup.service.js";
import { findLinkByListId } from "../services/project-link.service.js";
import { sendMessageToProjectLink } from "../services/discord-notify.service.js";
import { buildTaskName } from "../utils/task-name.util.js";
import {
    calculateDueDateByPriority,
    shouldUpdateDueDate,
} from "../utils/due-date.util.js";
import { formatDateTimeTH } from "../utils/date.util.js";

const router = Router();

function extractTaskId(body: ClickUpWebhookPayload): string | null {
    return (
        body.task_id ||
        body.task?.id ||
        body.history_items?.find((item) => item.task_id)?.task_id ||
        null
    );
}

router.post("/webhook", async (req, res) => {
    try {
        const body = req.body as ClickUpWebhookPayload;

        console.log("ClickUp webhook:", JSON.stringify(body, null, 2));

        const taskId = extractTaskId(body);

        if (!taskId) {
            return res.status(200).json({
                ok: true,
                skipped: true,
                reason: "No task id",
            });
        }

        const task = await getTask(taskId);

        let finalName = task.name;

        const newName = buildTaskName(task);

        if (newName.trim().toUpperCase() !== task.name.trim().toUpperCase()) {
            await updateTaskName(task.id, newName);
            finalName = newName;
        }

        let dueDate = task.due_date ?? null;

        if (shouldUpdateDueDate(task)) {
            const calculatedDueDate = calculateDueDateByPriority(task);

            if (calculatedDueDate) {
                await updateTaskDueDate(task.id, calculatedDueDate);
                dueDate = calculatedDueDate;
            }
        }

        if (body.event === "taskCreated") {
            const listId = task.list?.id;

            if (listId) {
                const link = await findLinkByListId(listId);

                if (link) {
                    const message = [
                        "🆕 **New ClickUp Task**",
                        "",
                        `**${finalName}**`,
                        `Status: ${task.status?.status || "-"}`,
                        `Priority: ${task.priority?.priority || "-"}`,
                        `Due: ${formatDateTimeTH(dueDate)}`,
                        task.url ? task.url : "",
                    ]
                        .filter(Boolean)
                        .join("\n");

                    await sendMessageToProjectLink(client, link, message);
                }
            }
        }

        return res.json({
            ok: true,
            taskId: task.id,
            name: finalName,
            dueDate,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        console.error("ClickUp webhook error:", error);

        return res.status(500).json({
            ok: false,
            error: message,
        });
    }
});

export default router;