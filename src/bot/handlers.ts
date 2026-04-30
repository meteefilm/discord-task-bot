import {
    MessageFlags,
    type ChatInputCommandInteraction,
    type Client,
} from "discord.js";

import {
    getActiveProjectLinks,
    getProjectLinks,
    unlinkProjectLink,
    upsertProjectLink,
} from "../services/project-link.service.js";

import {
    getClickUpFolderOptions,
    getClickUpListsByFolderOption,
    getTasksByListId,
    resolveClickUpListName,
} from "../services/clickup.service.js";

import { buildTaskSummaryMessage } from "../services/task-summary.service.js";
import { sendMessageToProjectLink } from "../services/discord-notify.service.js";

function getThreadId(itx: ChatInputCommandInteraction): string | undefined {
    return itx.channel?.isThread?.() ? itx.channelId : undefined;
}

export function registerInteractionHandlers(client: Client): void {
    client.on("interactionCreate", async (itx) => {
        try {
            // =========================
            // AUTOCOMPLETE
            // =========================
            if (itx.isAutocomplete()) {
                if (itx.commandName !== "clickup") return;

                const sub = itx.options.getSubcommand(false);
                const focused = itx.options.getFocused(true);

                // ===== folder autocomplete =====
                if (sub === "link-list" && focused.name === "folder") {
                    const q = String(focused.value || "").toLowerCase();

                    const folders = await getClickUpFolderOptions();

                    const options = folders
                        .filter((f) => f.name.toLowerCase().includes(q))
                        .slice(0, 25)
                        .map((f) => ({
                            name: f.name.slice(0, 100),
                            value: `${f.type}:${f.id}`,
                        }));

                    await itx.respond(options);
                    return;
                }

                // ===== list autocomplete (link-list) =====
                if (sub === "link-list" && focused.name === "list") {
                    const folderValue = itx.options.getString("folder");

                    if (!folderValue) {
                        await itx.respond([]);
                        return;
                    }

                    const q = String(focused.value || "").toLowerCase();

                    const lists = await getClickUpListsByFolderOption(folderValue);

                    const options = lists
                        .filter((l) => l.name.toLowerCase().includes(q))
                        .slice(0, 25)
                        .map((l) => ({
                            name: l.name.slice(0, 100),
                            value: l.id,
                        }));

                    await itx.respond(options);
                    return;
                }

                // ===== unlink-list autocomplete =====
                if (sub === "unlink-list" && focused.name === "list") {
                    const currentThreadId = itx.channel?.isThread?.()
                        ? itx.channelId
                        : undefined;

                    const q = String(focused.value || "").toLowerCase();

                    const links = await getActiveProjectLinks();

                    const currentLinks = links.filter((link) => {
                        if (currentThreadId) return link.threadId === currentThreadId;
                        return link.channelId === itx.channelId && !link.threadId;
                    });

                    const options = currentLinks
                        .filter((l) => l.clickupName.toLowerCase().includes(q))
                        .slice(0, 25)
                        .map((l) => ({
                            name: l.clickupName.slice(0, 100),
                            value: l.clickupId,
                        }));

                    await itx.respond(options);
                    return;
                }

                await itx.respond([]);
                return;
            }

            // =========================
            // COMMAND
            // =========================
            if (!itx.isChatInputCommand()) return;
            if (itx.commandName !== "clickup") return;

            const sub = itx.options.getSubcommand();

            // ===== link-list =====
            if (sub === "link-list") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const folderValue = itx.options.getString("folder", true);
                const listId = itx.options.getString("list", true);

                const clickupName = await resolveClickUpListName(
                    folderValue,
                    listId,
                );

                await upsertProjectLink({
                    clickupType: "list",
                    clickupId: listId,
                    clickupName,
                    guildId: itx.guildId || "",
                    channelId: itx.channelId,
                    threadId: getThreadId(itx),
                    createdBy: itx.user.id,
                    createdAt: new Date().toISOString(),
                    active: true,
                });

                await itx.editReply(
                    `✅ Linked ClickUp List **${clickupName}** แล้ว`,
                );

                return;
            }

            // ===== unlink-list =====
            if (sub === "unlink-list") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const listId = itx.options.getString("list", true);

                const ok = await unlinkProjectLink({
                    clickupId: listId,
                    channelId: itx.channelId,
                    threadId: getThreadId(itx),
                });

                await itx.editReply(
                    ok
                        ? `🗑️ Unlinked List ${listId} แล้ว`
                        : `❌ ไม่พบ list นี้ในห้องนี้`,
                );

                return;
            }

            // ===== links =====
            if (sub === "links") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const links = await getProjectLinks();
                const currentThreadId = getThreadId(itx);

                const active = links.filter((link) => {
                    if (!link.active) return false;

                    // ถ้าอยู่ใน thread → แสดงเฉพาะ link ของ thread นี้
                    if (currentThreadId) {
                        return link.threadId === currentThreadId;
                    }

                    // ถ้าอยู่ใน channel ปกติ → แสดงเฉพาะ link ของ channel นี้ และไม่ใช่ thread
                    return link.channelId === itx.channelId && !link.threadId;
                });

                if (!active.length) {
                    await itx.editReply("ยังไม่มี ClickUp List ที่ link กับห้อง/เทรดนี้");
                    return;
                }

                const text = active
                    .map((link, index) => {
                        const target = link.threadId
                            ? `<#${link.threadId}>`
                            : `<#${link.channelId}>`;

                        return `${index + 1}. **${link.clickupName}** → ${target}`;
                    })
                    .join("\n");

                await itx.editReply(text);
                return;
            }

            // ===== summary =====
            if (sub === "summary") {
                await itx.deferReply();

                const links = await getActiveProjectLinks();
                const currentThreadId = getThreadId(itx);

                const link = links.find((l) => {
                    if (currentThreadId) return l.threadId === currentThreadId;
                    return l.channelId === itx.channelId && !l.threadId;
                });

                if (!link) {
                    await itx.editReply("ยังไม่ได้ link");
                    return;
                }

                const tasks = await getTasksByListId(link.clickupId);

                const msg = buildTaskSummaryMessage({
                    title: link.clickupName,
                    tasks,
                });

                const chunks = splitDiscordMessage(msg);

                await itx.editReply(chunks[0]);

                for (let i = 1; i < chunks.length; i++) {
                    await itx.followUp(chunks[i]);
                }

                return;
            }
        } catch (error) {
            console.error("interaction error:", error);

            if (itx.isRepliable()) {
                const message =
                    error instanceof Error ? error.message : "Unknown error";

                if (itx.deferred || itx.replied) {
                    await itx.editReply(`❌ ${message}`).catch(() => null);
                } else {
                    await itx
                        .reply({
                            content: `❌ ${message}`,
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => null);
                }
            }
        }
    });
}

function splitDiscordMessage(content: string, limit = 1900): string[] {
    if (content.length <= limit) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > limit) {
        let splitIndex = remaining.lastIndexOf("\n", limit);
        if (splitIndex <= 0) splitIndex = limit;

        chunks.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
    }

    if (remaining.length) chunks.push(remaining);
    return chunks;
}