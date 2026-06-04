import cron from "node-cron";
import type {
  Client,
  Collection,
  Message,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";
import { getActiveProjectLinks } from "../services/project-link.service.js";

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

const SUMMARY_MARKER = "<!-- SG_SUMMARY -->";
const TASK_NOTIFY_MARKER = "<!-- SG_TASK_NOTIFY -->";
const CLEANUP_MARKERS = [SUMMARY_MARKER, TASK_NOTIFY_MARKER];

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_NOTIFY_TTL_DAYS = Number(process.env.TASK_NOTIFY_TTL_DAYS || 2);
const CLEANUP_FETCH_LIMIT = Number(process.env.CLEANUP_FETCH_LIMIT || 500);
const SUMMARY_SPLIT_CLEANUP_WINDOW_MS =
  Number(process.env.SUMMARY_SPLIT_CLEANUP_WINDOW_MINUTES || 10) * 60 * 1000;

const CLEANUP_CRON = process.env.CLEANUP_CRON || "10 9 * * *";
const TIMEZONE = process.env.TZ || "Asia/Bangkok";

export interface CleanupBotMessagesResult {
  targets: number;
  scanned: number;
  matched: number;
  deleted: number;
}

export interface CleanupBotMessagesOptions {
  deleteAllBotMessages?: boolean;
  deleteAllOldMarkers?: boolean;
  targetIds?: string[];
}

async function fetchLinkedChannel(
  client: Client,
  channelId: string,
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) return null;

  if (channel.isThread()) {
    try {
      await channel.join();
    } catch {
      // ignore
    }

    return channel;
  }

  if (channel.isTextBased() && "messages" in channel && "send" in channel) {
    return channel as SendableChannel;
  }

  return null;
}

function getDateKey(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-CA", {
    timeZone: TIMEZONE,
  });
}

function getDateIndex(timestamp: number): number {
  const [year, month, day] = getDateKey(timestamp).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function getCalendarAgeDays(messageCreatedAt: number, now = Date.now()): number {
  return getDateIndex(now) - getDateIndex(messageCreatedAt);
}

function isOldSummaryMessage(messageCreatedAt: number): boolean {
  return getDateKey(messageCreatedAt) !== getDateKey(Date.now());
}

function isOldMessage(messageCreatedAt: number): boolean {
  return getDateKey(messageCreatedAt) !== getDateKey(Date.now());
}

function isExpiredTaskNotifyMessage(messageCreatedAt: number): boolean {
  return getCalendarAgeDays(messageCreatedAt) >= TASK_NOTIFY_TTL_DAYS;
}

async function fetchMessagesForCleanup(channel: SendableChannel) {
  const messages: Message[] = [];
  let before: string | undefined;

  while (messages.length < CLEANUP_FETCH_LIMIT) {
    const batch: Collection<string, Message> = await channel.messages.fetch({
      limit: Math.min(100, CLEANUP_FETCH_LIMIT - messages.length),
      before,
    });

    if (!batch.size) break;

    messages.push(...batch.values());
    before = batch.last()?.id;

    if (!before) break;
  }

  return messages;
}

export async function runCleanupBotMessages(
  client: Client,
  options: CleanupBotMessagesOptions = {},
): Promise<CleanupBotMessagesResult> {
  const links = await getActiveProjectLinks();
  const targetIds = options.targetIds?.length
    ? options.targetIds
    : [...new Set(links.map((link) => link.threadId || link.channelId))];

  let scanned = 0;
  let deleted = 0;
  let matched = 0;

  for (const targetId of targetIds) {
    try {
      const channel = await fetchLinkedChannel(client, targetId);

      if (!channel) continue;

      const messages = await fetchMessagesForCleanup(channel);
      let legacySummaryMarkerCreatedAt: number | null = null;

      for (const message of messages) {
        scanned++;
        if (message.author.id !== client.user?.id) continue;

        if (options.deleteAllBotMessages) {
          matched++;

          const ok = await message.delete().then(
            () => true,
            (error: unknown) => {
              console.error("[CleanupBotMessages] delete bot message failed:", {
                targetId,
                messageId: message.id,
                error,
              });
              return false;
            },
          );

          if (ok) deleted++;
          continue;
        }

        const content = message.content || "";

        const isSummary = content.includes(SUMMARY_MARKER);
        const isTaskNotify = content.includes(TASK_NOTIFY_MARKER);
        const hasCleanupMarker = CLEANUP_MARKERS.some((marker) =>
          content.includes(marker),
        );

        if (legacySummaryMarkerCreatedAt && !hasCleanupMarker) {
          const isLegacySummaryChunk =
            isOldMessage(message.createdTimestamp) &&
            legacySummaryMarkerCreatedAt >= message.createdTimestamp &&
            legacySummaryMarkerCreatedAt - message.createdTimestamp <=
              SUMMARY_SPLIT_CLEANUP_WINDOW_MS;

          if (isLegacySummaryChunk) {
            const ok = await message.delete().then(
              () => true,
              (error: unknown) => {
                console.error(
                  "[CleanupBotMessages] delete legacy summary chunk failed:",
                  {
                    targetId,
                    messageId: message.id,
                    error,
                  },
                );
                return false;
              },
            );
            if (ok) deleted++;
            continue;
          }

          legacySummaryMarkerCreatedAt = null;
        }

        if (!hasCleanupMarker) continue;
        matched++;

        const shouldDelete = options.deleteAllOldMarkers
          ? isOldMessage(message.createdTimestamp)
          : (isSummary && isOldSummaryMessage(message.createdTimestamp)) ||
            (isTaskNotify &&
              isExpiredTaskNotifyMessage(message.createdTimestamp));

        if (!shouldDelete) continue;

        const ok = await message.delete().then(
          () => true,
          (error: unknown) => {
            console.error("[CleanupBotMessages] delete failed:", {
              targetId,
              messageId: message.id,
              ageDays: getCalendarAgeDays(message.createdTimestamp),
              error,
            });
            return false;
          },
        );

        if (ok) {
          deleted++;

          if (isSummary) {
            legacySummaryMarkerCreatedAt = message.createdTimestamp;
          }
        }
      }
    } catch (error) {
      console.error("[CleanupBotMessages] target failed:", {
        targetId,
        error,
      });
    }
  }

  return {
    targets: targetIds.length,
    scanned,
    matched,
    deleted,
  };
}

export function startCleanupBotMessagesJob(client: Client): void {
  cron.schedule(
    CLEANUP_CRON,
    async () => {
      console.log("[CleanupBotMessages] start", {
        cron: CLEANUP_CRON,
        timezone: TIMEZONE,
        taskNotifyTtlDays: TASK_NOTIFY_TTL_DAYS,
        fetchLimit: CLEANUP_FETCH_LIMIT,
      });

      const result = await runCleanupBotMessages(client);

      console.log("[CleanupBotMessages] done", result);
    },
    {
      timezone: TIMEZONE,
    },
  );
}
