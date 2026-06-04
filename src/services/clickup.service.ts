import axios from "axios";
import type { ClickUpTask, ClickUpUserOption } from "../types/clickup.type.js";

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN;

if (!CLICKUP_TOKEN) {
    throw new Error("Missing CLICKUP_TOKEN");
}

const clickupApi = axios.create({
    baseURL: "https://api.clickup.com/api/v2",
    timeout: 15000,
    headers: {
        Authorization: CLICKUP_TOKEN,
        "Content-Type": "application/json",
    },
});

export interface ClickUpFolderOption {
    id: string;
    name: string;
    type: "space" | "folder";
    spaceId?: string;
    spaceName?: string;
}

export interface ClickUpListOption {
    id: string;
    name: string;
    folderId?: string;
    folderName?: string;
    spaceId?: string;
    spaceName?: string;
}

export async function getTask(taskId: string): Promise<ClickUpTask> {
    const response = await clickupApi.get(`/task/${taskId}`);
    return response.data as ClickUpTask;
}

export async function updateTaskName(
    taskId: string,
    name: string,
): Promise<void> {
    await clickupApi.put(`/task/${taskId}`, { name });
}

export async function updateTaskDueDate(
    taskId: string,
    dueDate: number,
): Promise<void> {
    await clickupApi.put(`/task/${taskId}`, { due_date: dueDate });
}

export async function getTasksByListId(listId: string): Promise<ClickUpTask[]> {
    const response = await clickupApi.get(`/list/${listId}/task`, {
        params: {
            include_closed: false,
            subtasks: true,
        },
    });

    return response.data.tasks as ClickUpTask[];
}

export async function getClickUpFolderOptions(): Promise<ClickUpFolderOption[]> {
    const teamId = process.env.CLICKUP_TEAM_ID;

    if (!teamId) {
        throw new Error("Missing CLICKUP_TEAM_ID");
    }

    const spacesRes = await clickupApi.get(`/team/${teamId}/space`, {
        params: {
            archived: false,
        },
    });

    const spaces = spacesRes.data.spaces ?? [];
    const result: ClickUpFolderOption[] = [];

    for (const space of spaces) {
        result.push({
            id: String(space.id),
            name: String(space.name),
            type: "space",
            spaceId: String(space.id),
            spaceName: String(space.name),
        });

        const foldersRes = await clickupApi.get(`/space/${space.id}/folder`, {
            params: {
                archived: false,
            },
        });

        const folders = foldersRes.data.folders ?? [];

        for (const folder of folders) {
            result.push({
                id: String(folder.id),
                name: `${space.name} / ${folder.name}`,
                type: "folder",
                spaceId: String(space.id),
                spaceName: String(space.name),
            });
        }
    }

    return result;
}

export async function getClickUpListsByFolderOption(
    folderValue: string,
): Promise<ClickUpListOption[]> {
    const [type, id] = folderValue.split(":");

    if (!type || !id) return [];

    if (type === "space") {
        const res = await clickupApi.get(`/space/${id}/list`, {
            params: {
                archived: false,
            },
        });

        const lists = res.data.lists ?? [];

        return lists.map((list: any) => ({
            id: String(list.id),
            name: String(list.name),
            spaceId: id,
        }));
    }

    if (type === "folder") {
        const res = await clickupApi.get(`/folder/${id}/list`, {
            params: {
                archived: false,
            },
        });

        const lists = res.data.lists ?? [];

        return lists.map((list: any) => ({
            id: String(list.id),
            name: String(list.name),
            folderId: id,
        }));
    }

    return [];
}

export async function resolveClickUpListName(
    folderValue: string,
    listId: string,
): Promise<string> {
    const folders = await getClickUpFolderOptions();

    const folder = folders.find(
        (item) => `${item.type}:${item.id}` === folderValue,
    );

    const lists = await getClickUpListsByFolderOption(folderValue);

    const list = lists.find((item) => item.id === listId);

    if (!folder || !list) return listId;

    return `${folder.name} / ${list.name}`;
}

export async function getClickUpUsers(): Promise<ClickUpUserOption[]> {
    const teamId = process.env.CLICKUP_TEAM_ID;

    if (!teamId) {
        throw new Error("Missing CLICKUP_TEAM_ID");
    }

    const response = await clickupApi.get(`/team/${teamId}`);

    const members = response.data.members ?? [];
    console.log('members :', members);

    return members
        .map((member: any) => {
            const user = member.user ?? member;

            return {
                id: String(user.id),
                name: String(user.username || user.email || user.id),
                email: user.email ? String(user.email) : undefined,
            };
        })
        .filter((user: ClickUpUserOption) => user.id && user.name);
}

export async function getClickUpUserById(
    userId: string,
): Promise<ClickUpUserOption | null> {
    const users = await getClickUpUsers();

    return users.find((user) => user.id === String(userId)) ?? null;
}