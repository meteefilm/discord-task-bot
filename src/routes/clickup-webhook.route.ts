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
import { formatAssignees } from "../services/task-summary.service.js";

const router = Router();

type ClickUpAutomationPayload = {
    auto_id?: string;
    trigger_id?: string;
    date?: string;
    payload?: {
        id?: string;
        name?: string;
        priority?: string | number | null;
        subcategory?: string;
        lists?: Array<{
            list_id?: string;
            type?: string;
        }>;
    };
};

type AnyClickUpPayload = ClickUpWebhookPayload & ClickUpAutomationPayload;

function extractTaskId(body: AnyClickUpPayload): string | null {
    return (
        body.task_id ||
        body.task?.id ||
        body.payload?.id ||
        body.history_items?.find((item) => item.task_id)?.task_id ||
        null
    );
}

function extractListId(body: AnyClickUpPayload, task?: any): string | null {
    return (
        task?.list?.id ||
        body.payload?.lists?.[0]?.list_id ||
        body.payload?.subcategory ||
        null
    );
}

function shouldNotifyDiscord(body: AnyClickUpPayload): boolean {
    // Event-based webhook
    if (body.event === "taskCreated") return true;

    // ClickUp Automation webhook จะไม่มี event แต่มี payload
    if (body.payload?.id) return true;

    return false;
}

router.post("/webhook", async (req, res) => {
    try {
        const body = req.body as AnyClickUpPayload;

        console.log("ClickUp webhook:", JSON.stringify(body, null, 2));

        // ClickUp test webhook
        if ((body as any).body === "Test message from ClickUp Webhooks Service") {
            return res.json({
                ok: true,
                test: true,
            });
        }

        const taskId = extractTaskId(body);

        if (!taskId) {
            return res.json({
                ok: true,
                skipped: true,
                reason: "No task id",
            });
        }

        const task = await getTask(taskId);

        // =========================
        // 1. Auto rename
        // =========================
        let finalName = task.name;

        const newName = buildTaskName(task);

        if (newName.trim().toUpperCase() !== task.name.trim().toUpperCase()) {
            await updateTaskName(task.id, newName);
            finalName = newName;

            console.log("Rename task:", {
                taskId: task.id,
                oldName: task.name,
                newName,
            });
        }

        // =========================
        // 2. Auto due date
        // =========================
        let dueDate = task.due_date ?? null;

        if (shouldUpdateDueDate(task)) {
            const calculatedDueDate = calculateDueDateByPriority(task);

            if (calculatedDueDate) {
                await updateTaskDueDate(task.id, calculatedDueDate);
                dueDate = calculatedDueDate;

                console.log("Set due date:", {
                    taskId: task.id,
                    dueDate: calculatedDueDate,
                });
            }
        }

        // =========================
        // 3. Notify Discord
        // =========================
        if (shouldNotifyDiscord(body)) {
            const listId = extractListId(body, task);

            if (!listId) {
                return res.json({
                    ok: true,
                    taskId: task.id,
                    name: finalName,
                    dueDate,
                    notified: false,
                    reason: "No list id",
                });
            }

            const link = await findLinkByListId(listId);

            if (!link) {
                return res.json({
                    ok: true,
                    taskId: task.id,
                    name: finalName,
                    dueDate,
                    notified: false,
                    reason: `No Discord link for list ${listId}`,
                });
            }
            const assignees = formatAssignees(task);
            const message = [
                "🆕 **New ClickUp Task**",
                "",
                `**${finalName}**`,
                `Status: ${task.status?.status || "-"}`,
                `Priority: ${task.priority?.priority || "-"}`,
                `Due: ${formatDateTimeTH(dueDate)}`,
                `Assignees: ${assignees}`,
                `<${task.url}>` || "",
            ]
                .filter(Boolean)
                .join("\n");

            await sendMessageToProjectLink(client, link, message);

            return res.json({
                ok: true,
                taskId: task.id,
                listId,
                name: finalName,
                dueDate,
                notified: true,
                target: link.threadId || link.channelId,
            });
        }

        return res.json({
            ok: true,
            taskId: task.id,
            name: finalName,
            dueDate,
            notified: false,
            reason: "Unsupported event",
        });
    } catch (error) {
        console.error("ClickUp webhook error:", error);

        return res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
});

export default router;