export interface ClickUpProjectLink {
    clickupType: "list";
    clickupId: string;
    clickupName: string;

    guildId: string;
    channelId: string;
    threadId?: string;

    createdBy: string;
    createdAt: string;
    active: boolean;
}