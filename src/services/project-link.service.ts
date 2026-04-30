import { promises as fs } from "fs";
import path from "path";
import type { ClickUpProjectLink } from "../types/project-link.type.js";

const FILE = path.join(process.cwd(), "data", "clickup-project-links.json");

async function ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(FILE), { recursive: true });

    try {
        await fs.access(FILE);
    } catch {
        await fs.writeFile(FILE, "[]");
    }
}

export async function getProjectLinks(): Promise<ClickUpProjectLink[]> {
    await ensureFile();

    const raw = await fs.readFile(FILE, "utf8");

    if (!raw.trim()) {
        await saveProjectLinks([]);
        return [];
    }

    try {
        return JSON.parse(raw) as ClickUpProjectLink[];
    } catch {
        await saveProjectLinks([]);
        return [];
    }
}

async function saveProjectLinks(links: ClickUpProjectLink[]): Promise<void> {
    await ensureFile();
    await fs.writeFile(FILE, JSON.stringify(links, null, 2));
}

export async function upsertProjectLink(link: ClickUpProjectLink): Promise<void> {
    const links = await getProjectLinks();

    const index = links.findIndex(
        (item) =>
            item.clickupType === link.clickupType &&
            item.clickupId === link.clickupId &&
            item.channelId === link.channelId &&
            item.threadId === link.threadId,
    );

    if (index >= 0) {
        links[index] = { ...links[index], ...link, active: true };
    } else {
        links.push(link);
    }

    await saveProjectLinks(links);
}

export async function unlinkProjectLink(params: {
    clickupId: string;
    channelId: string;
    threadId?: string;
}): Promise<boolean> {
    const links = await getProjectLinks();

    let changed = false;

    const next = links.map((link) => {
        const matched =
            link.clickupId === params.clickupId &&
            link.channelId === params.channelId &&
            link.threadId === params.threadId;

        if (!matched) return link;

        changed = true;
        return { ...link, active: false };
    });

    await saveProjectLinks(next);
    return changed;
}

export async function getActiveProjectLinks(): Promise<ClickUpProjectLink[]> {
    const links = await getProjectLinks();
    return links.filter((link) => link.active);
}

export async function findLinkByListId(
    listId: string,
): Promise<ClickUpProjectLink | null> {
    const links = await getActiveProjectLinks();

    return (
        links.find(
            (link) => link.clickupType === "list" && link.clickupId === listId,
        ) ?? null
    );
}