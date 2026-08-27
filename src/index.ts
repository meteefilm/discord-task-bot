import "dotenv/config";
import express from "express";
import { client } from "./bot/client.js";
import { registerCommands, registerGuildCommandSync } from "./bot/commands.js";
import { registerInteractionHandlers } from "./bot/handlers.js";
import clickupWebhookRoute from "./routes/clickup-webhook.route.js";
import { startDailyTaskSummaryJob } from "./jobs/daily-task-summary.job.js";
import { startCleanupBotMessagesJob } from "./jobs/cleanup-bot-messages.job.js";

const PORT = Number(process.env.PORT || 8322);

process.on("unhandledRejection", (error) => {
    console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION:", error);
});

const app = express();
app.use(express.json());

app.get("/discord-bot/health", (_, res) => {
    res.json({ ok: true });
});

app.use("/discord-bot", clickupWebhookRoute);

app.listen(PORT, () => {
    console.log(`HTTP server running on port ${PORT}`);
});

client.once("ready", async () => {
    console.log(`Discord bot logged in as ${client.user?.tag}`);

    await registerCommands(client);
    startDailyTaskSummaryJob(client);
    startCleanupBotMessagesJob(client);
});

registerInteractionHandlers(client);
registerGuildCommandSync(client);

await client.login(process.env.DISCORD_TOKEN);
