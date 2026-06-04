import type {
    Client,
    TextChannel,
    NewsChannel,
    ThreadChannel,
} from "discord.js";
import type { ClickUpProjectLink } from "../types/project-link.type.js";

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

const DISCORD_MESSAGE_LIMIT = 1900;
const CLEANUP_MARKERS = ["<!-- SG_SUMMARY -->", "<!-- SG_TASK_NOTIFY -->"];

function splitDiscordMessage(content: string): string[] {
    const marker = CLEANUP_MARKERS.find((item) => content.includes(item));
    const markerSuffix = marker ? `\n\n${marker}` : "";
    const limit = DISCORD_MESSAGE_LIMIT - markerSuffix.length;
    let remaining = marker ? content.replace(marker, "").trim() : content;

    const chunks: string[] = [];

    while (remaining.length > limit) {
        let splitIndex = remaining.lastIndexOf("\n", limit);

        if (splitIndex <= 0) {
            splitIndex = limit;
        }

        chunks.push(`${remaining.slice(0, splitIndex).trim()}${markerSuffix}`);
        remaining = remaining.slice(splitIndex).trim();
    }

    if (remaining.length) {
        chunks.push(`${remaining}${markerSuffix}`);
    }

    return chunks;
}

export async function getLinkedChannel(
    client: Client,
    link: ClickUpProjectLink,
): Promise<SendableChannel | null> {
    const targetId = link.threadId || link.channelId;

    const channel = await client.channels.fetch(targetId).catch(() => null);

    if (!channel) return null;

    if (channel.isThread()) {
        try {
            await channel.join();
        } catch {
            // ignore
        }

        return channel;
    }

    if (channel.isTextBased() && "send" in channel) {
        return channel as SendableChannel;
    }

    return null;
}

export async function sendMessageToProjectLink(
    client: Client,
    link: ClickUpProjectLink,
    content: string,
): Promise<void> {
    const channel = await getLinkedChannel(client, link);

    if (!channel) return;

    const chunks = splitDiscordMessage(content);

    for (const chunk of chunks) {
        await channel.send(chunk);
    }
}
