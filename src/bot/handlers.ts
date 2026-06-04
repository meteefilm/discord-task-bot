import {
    MessageFlags,
    PermissionFlagsBits,
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
    getClickUpUsers,
    getClickUpUserById,
} from "../services/clickup.service.js";

import {
    getUserMappings,
    removeUserMappingByClickUpId,
    upsertUserMapping,
} from "../services/user-map.service.js";

import { buildTaskSummaryMessage } from "../services/task-summary.service.js";
import { sendMessageToProjectLink } from "../services/discord-notify.service.js";
import { runCleanupBotMessages } from "../jobs/cleanup-bot-messages.job.js";

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

                // ===== map-user: clickup user autocomplete =====
                if (sub === "map-user" && focused.name === "clickup_user") {
                    const q = String(focused.value || "").toLowerCase();

                    const users = await getClickUpUsers();

                    const options = users
                        .filter((user) =>
                            `${user.name} ${user.email ?? ""}`.toLowerCase().includes(q),
                        )
                        .slice(0, 25)
                        .map((user) => ({
                            name: `${user.name}${user.email ? ` (${user.email})` : ""}`.slice(0, 100),
                            value: user.id,
                        }));

                    await itx.respond(options);
                    return;
                }

                // ===== map-user: discord user autocomplete =====
                if (sub === "map-user" && focused.name === "discord_user") {
                    const q = String(focused.value || "").toLowerCase();

                    if (!itx.guild) {
                        await itx.respond([]);
                        return;
                    }

                    const members = await itx.guild.members.fetch();

                    const options = [...members.values()]
                        .filter((member) => !member.user.bot)
                        .filter((member) =>
                            `${member.displayName} ${member.user.username}`
                                .toLowerCase()
                                .includes(q),
                        )
                        .slice(0, 25)
                        .map((member) => ({
                            name: `${member.displayName} (@${member.user.username})`.slice(0, 100),
                            value: member.user.id,
                        }));

                    await itx.respond(options);
                    return;
                }

                // ===== unmap-user autocomplete =====
                if (sub === "unmap-user" && focused.name === "clickup_user") {
                    const q = String(focused.value || "").toLowerCase();

                    const mappings = await getUserMappings();

                    const options = mappings
                        .filter((mapping) =>
                            `${mapping.clickupName} ${mapping.discordName}`
                                .toLowerCase()
                                .includes(q),
                        )
                        .slice(0, 25)
                        .map((mapping) => ({
                            name: `${mapping.clickupName} → ${mapping.discordName}`.slice(0, 100),
                            value: mapping.clickupUserId,
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

                if (!msg) {
                    await itx.deleteReply().catch(() => null);
                    await itx.followUp({
                        content: "ไม่มี task ที่ค้างอยู่ครับ",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                const chunks = splitDiscordMessage(msg);

                await itx.editReply(chunks[0]);

                for (let i = 1; i < chunks.length; i++) {
                    await itx.followUp(chunks[i]);
                }

                return;
            }

            // ===== cleanup =====
            if (sub === "cleanup") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                if (!itx.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
                    await itx.editReply("ต้องมี permission Manage Messages ก่อนใช้งานคำสั่งนี้");
                    return;
                }

                const scope = itx.options.getString("scope") || "current";
                const mode = itx.options.getString("mode") || "old-markers";
                const targetIds =
                    scope === "all" ? undefined : [getThreadId(itx) || itx.channelId];

                const result = await runCleanupBotMessages(client, {
                    deleteAllBotMessages: mode === "all-bot-messages",
                    deleteAllOldMarkers: mode === "old-markers",
                    targetIds,
                });

                await itx.editReply(
                    [
                        "Cleanup finished",
                        `Scope: ${scope}`,
                        `Mode: ${mode}`,
                        `Targets: ${result.targets}`,
                        `Scanned: ${result.scanned}`,
                        `Matched: ${result.matched}`,
                        `Deleted: ${result.deleted}`,
                    ].join("\n"),
                );

                return;
            }

            // ===== map-user =====
            if (sub === "map-user") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const clickupUserId = itx.options.getString("clickup_user", true);
                const discordUserId = itx.options.getString("discord_user", true);

                const clickupUser = await getClickUpUserById(clickupUserId);

                if (!clickupUser) {
                    await itx.editReply("❌ ไม่พบ ClickUp user นี้");
                    return;
                }

                const discordMember = await itx.guild?.members
                    .fetch(discordUserId)
                    .catch(() => null);

                if (!discordMember) {
                    await itx.editReply("❌ ไม่พบ Discord user นี้ใน server");
                    return;
                }

                await upsertUserMapping({
                    clickupUserId,
                    clickupName: clickupUser.name,

                    discordUserId,
                    discordName: discordMember.displayName,

                    mappedBy: itx.user.id,
                    mappedAt: new Date().toISOString(),
                });

                await itx.editReply(
                    `✅ Mapped **${clickupUser.name}** → <@${discordUserId}> แล้ว`,
                );

                return;
            }

            // ===== unmap-user =====
            if (sub === "unmap-user") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const clickupUserId = itx.options.getString("clickup_user", true);

                const ok = await removeUserMappingByClickUpId(clickupUserId);

                await itx.editReply(
                    ok
                        ? "✅ ลบ user mapping แล้ว"
                        : "❌ ไม่พบ mapping ของ user นี้",
                );

                return;
            }

            // ===== user-maps =====
            if (sub === "user-maps") {
                await itx.deferReply({ flags: MessageFlags.Ephemeral });

                const mappings = await getUserMappings();

                if (!mappings.length) {
                    await itx.editReply("ยังไม่มี user mapping");
                    return;
                }

                const text = mappings
                    .map((mapping, index) => {
                        return `${index + 1}. **${mapping.clickupName}** → <@${mapping.discordUserId}>`;
                    })
                    .join("\n");

                await itx.editReply(text);
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
    const cleanupMarkers = ["<!-- SG_SUMMARY -->", "<!-- SG_TASK_NOTIFY -->"];
    const marker = cleanupMarkers.find((item) => content.includes(item));
    const markerSuffix = marker ? `\n\n${marker}` : "";
    const chunkLimit = limit - markerSuffix.length;
    let remaining = marker ? content.replace(marker, "").trim() : content;

    const chunks: string[] = [];

    while (remaining.length > chunkLimit) {
        let splitIndex = remaining.lastIndexOf("\n", chunkLimit);
        if (splitIndex <= 0) splitIndex = chunkLimit;

        chunks.push(`${remaining.slice(0, splitIndex).trim()}${markerSuffix}`);
        remaining = remaining.slice(splitIndex).trim();
    }

    if (remaining.length) chunks.push(`${remaining}${markerSuffix}`);
    return chunks;
}
