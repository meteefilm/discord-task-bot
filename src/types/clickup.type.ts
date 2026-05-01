export interface ClickUpTag {
    name: string;
}

export interface ClickUpTask {
    id: string;
    name: string;
    url?: string;
    tags?: Array<ClickUpTag | string>;

    priority?: {
        id?: string;
        priority?: string;
        color?: string;
        orderindex?: string;
    } | null;

    due_date?: string | number | null;

    status?: {
        status?: string;
        color?: string;
        type?: string;
    };

    assignees?: Array<{
        id: number;
        username?: string;
        email?: string;
    }>;

    list?: {
        id?: string;
        name?: string;
    };

    folder?: {
        id?: string;
        name?: string;
    };

    space?: {
        id?: string;
        name?: string;
    };
}

export interface ClickUpWebhookPayload {
    event?: string;
    task_id?: string;
    task?: {
        id?: string;
    };
    history_items?: Array<{
        task_id?: string;
    }>;

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
}