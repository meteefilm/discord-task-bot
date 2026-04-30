import cron from "node-cron";
import type { Client } from "discord.js";
import { getActiveProjectLinks } from "../services/project-link.service.js";
import { getTasksByListId } from "../services/clickup.service.js";
import { buildTaskSummaryMessage } from "../services/task-summary.service.js";
import { sendMessageToProjectLink } from "../services/discord-notify.service.js";

const CRON = process.env.DAILY_SUMMARY_CRON || "0 9 * * *";

export function startDailyTaskSummaryJob(client: Client): void {
    cron.schedule(
        CRON,
        async () => {
            console.log("[DailySummary] start");

            const links = await getActiveProjectLinks();

            for (const link of links) {
                try {
                    const tasks = await getTasksByListId(link.clickupId);

                    const message = buildTaskSummaryMessage({
                        title: link.clickupName,
                        tasks,
                    });

                    await sendMessageToProjectLink(client, link, message);
                } catch (error) {
                    console.error("[DailySummary] failed:", link, error);
                }
            }

            console.log("[DailySummary] done");
        },
        {
            timezone: "Asia/Bangkok",
        },
    );
}