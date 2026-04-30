import type {
    Client,
    TextChannel,
    NewsChannel,
    ThreadChannel,
} from "discord.js";
import type { ClickUpProjectLink } from "../types/project-link.type.js";

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

const DISCORD_MESSAGE_LIMIT = 1900;

function splitDiscordMessage(content: string): string[] {
    if (content.length <= DISCORD_MESSAGE_LIMIT) return [content];

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > DISCORD_MESSAGE_LIMIT) {
        let splitIndex = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);

        if (splitIndex <= 0) {
            splitIndex = DISCORD_MESSAGE_LIMIT;
        }

        chunks.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
    }

    if (remaining.length) {
        chunks.push(remaining);
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