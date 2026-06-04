# SG Discord ClickUp Bot

Discord bot สำหรับเชื่อม ClickUp กับ Discord เพื่อแจ้งเตือนงาน, สรุปงานรายวัน, และจัดการข้อความเก่าของ bot อัตโนมัติ

## Features

- รับ ClickUp webhook แล้วแจ้งเตือน task ใหม่เข้า Discord channel/thread ที่ผูกไว้
- ตั้งชื่อ task อัตโนมัติจาก project/list/tag
- ตั้ง due date อัตโนมัติตาม priority
- ส่ง Daily ClickUp Summary ทุกวันทำงานเวลา 09:00
- ไม่ส่ง summary ถ้าไม่มี open task เหลืออยู่
- ลบข้อความ summary/notification เก่าย้อนหลังด้วย cron หรือ slash command
- ผูก ClickUp List กับ Discord channel/thread ผ่าน slash command
- map ClickUp user กับ Discord user เพื่อใช้ต่อยอดกับ mention/assignee

## Architecture

```text
ClickUp
  -> Webhook
  -> Express API
  -> ClickUp service
  -> Discord bot
  -> Discord channel/thread

Cron jobs
  -> Daily summary
  -> Cleanup old bot messages

Slash commands
  -> Link/unlink ClickUp List
  -> Manual summary
  -> Manual cleanup
  -> User mapping
```

## Project Structure

```text
src/
  bot/
    client.ts                 Discord client setup
    commands.ts               Slash command definitions
    handlers.ts               Slash command and autocomplete handlers

  routes/
    clickup-webhook.route.ts  ClickUp webhook endpoint

  services/
    clickup.service.ts        ClickUp API client
    project-link.service.ts   ClickUp List <-> Discord channel/thread storage
    user-map.service.ts       ClickUp user <-> Discord user storage
    discord-notify.service.ts Send/split Discord messages
    task-summary.service.ts   Build summary messages

  jobs/
    daily-task-summary.job.ts Daily summary cron
    cleanup-bot-messages.job.ts Cleanup cron and manual cleanup runner

  utils/
    task-name.util.ts         Auto task name builder
    due-date.util.ts          Due date calculation
    date.util.ts              Thai/Bangkok date formatter

  types/
    clickup.type.ts
    project-link.type.ts
    summary.type.ts

data/
  clickup-project-links.json
  clickup-user-mappings.json
```

## Environment Variables

```env
DISCORD_TOKEN=
CLICKUP_TOKEN=
CLICKUP_TEAM_ID=

PORT=8322
TZ=Asia/Bangkok

DAILY_SUMMARY_CRON=0 9 * * 1-5
CLEANUP_CRON=10 9 * * *

TASK_NOTIFY_TTL_DAYS=2
CLEANUP_FETCH_LIMIT=500
SUMMARY_SPLIT_CLEANUP_WINDOW_MINUTES=10
```

Notes:

- `DAILY_SUMMARY_CRON=0 9 * * 1-5` ส่ง summary เวลา 09:00 วันจันทร์ถึงศุกร์
- `CLEANUP_CRON=10 9 * * *` ลบข้อความเก่าเวลา 09:10 ทุกวัน
- `TASK_NOTIFY_TTL_DAYS=2` ใช้กับ cleanup cron สำหรับ task notification
- manual cleanup command จะลบ marker เก่าทุกประเภทที่ไม่ใช่วันปัจจุบัน

## Webhook

ClickUp webhook endpoint:

```text
POST /discord-bot/webhook
```

ตัวอย่าง URL:

```text
https://your-domain.com/discord-bot/webhook
```

Webhook flow:

```text
receive webhook
  -> extract task id
  -> get task from ClickUp
  -> auto rename task
  -> auto set due date if missing
  -> find linked Discord target
  -> send notification
```

## Slash Commands

```text
/clickup link-list
/clickup unlink-list
/clickup links
/clickup summary
/clickup cleanup
/clickup map-user
/clickup unmap-user
/clickup user-maps
```

### Link ClickUp List

ใช้ใน channel หรือ thread ที่ต้องการให้ bot ส่งแจ้งเตือน:

```text
/clickup link-list
```

เลือก `folder` และ `list` ผ่าน autocomplete แล้ว bot จะบันทึก mapping ลง:

```text
data/clickup-project-links.json
```

### Manual Summary

```text
/clickup summary
```

ส่ง summary ของ ClickUp List ที่ผูกกับ channel/thread ปัจจุบันทันที

ถ้าไม่มี open task เหลืออยู่ bot จะไม่โพสต์ summary ลงห้อง และจะตอบกลับเฉพาะผู้เรียกคำสั่ง

### Manual Cleanup

```text
/clickup cleanup scope: current
/clickup cleanup scope: all
/clickup cleanup scope: current mode: old-markers
/clickup cleanup scope: current mode: all-bot-messages
```

คำสั่งนี้ใช้ลบข้อความเก่าของ bot ที่มี cleanup marker และไม่ใช่วันปัจจุบัน

รองรับ marker:

```text
<!-- SG_SUMMARY -->
<!-- SG_TASK_NOTIFY -->
```

Scope:

- `current` ลบเฉพาะ channel/thread ที่เรียกคำสั่ง
- `all` ลบทุก channel/thread ที่มีการ link ไว้

Mode:

- `old-markers` ลบเฉพาะข้อความเก่าที่มี marker และไม่ใช่วันปัจจุบัน
- `all-bot-messages` ลบทุกข้อความที่ส่งจาก bot ตัวนี้ใน scope ที่เลือก ไม่สน marker และไม่สนวันที่

ผู้ใช้ต้องมี permission:

```text
Manage Messages
```

## Scheduled Jobs

### Daily Summary

ไฟล์:

```text
src/jobs/daily-task-summary.job.ts
```

Default recommended cron:

```env
DAILY_SUMMARY_CRON=0 9 * * 1-5
```

ทำงานเวลา 09:00 วันจันทร์ถึงศุกร์ตาม timezone `Asia/Bangkok`

ถ้า list นั้นไม่มี open task เหลืออยู่ bot จะ skip และไม่ส่งข้อความเข้า Discord

### Cleanup Bot Messages

ไฟล์:

```text
src/jobs/cleanup-bot-messages.job.ts
```

Default cron:

```env
CLEANUP_CRON=10 9 * * *
```

ทำงานเวลา 09:10 ตาม timezone `Asia/Bangkok`

การลบแบบ cron:

- ลบ `SG_SUMMARY` ที่ไม่ใช่วันปัจจุบัน
- ลบ `SG_TASK_NOTIFY` ที่ครบอายุตาม `TASK_NOTIFY_TTL_DAYS`
- ลบ legacy summary chunks ที่เคยถูก split แล้ว marker อยู่เฉพาะ post สุดท้าย

## Discord Message Splitting

Discord จำกัดความยาวข้อความประมาณ 2,000 ตัวอักษร ดังนั้น bot จะ split ข้อความยาวเป็นหลาย post

สำหรับข้อความที่มี cleanup marker เช่น summary หรือ task notification ระบบจะใส่ marker ให้ทุก chunk เพื่อให้ cleanup ลบได้ครบทุก post:

```text
chunk 1 ... <!-- SG_SUMMARY -->
chunk 2 ... <!-- SG_SUMMARY -->
chunk 3 ... <!-- SG_SUMMARY -->
```

## Auto Due Date

ถ้า task ยังไม่มี due date bot จะตั้งตาม priority:

```text
urgent -> +4 hours
high   -> +1 day
normal -> +3 days
low    -> +7 days
```

## Data Files

### ClickUp Project Links

```text
data/clickup-project-links.json
```

ตัวอย่าง:

```json
[
  {
    "clickupType": "list",
    "clickupId": "901817490191",
    "clickupName": "NT Bangrak / PORTAL",
    "guildId": "123",
    "channelId": "456",
    "threadId": "789",
    "createdBy": "111",
    "createdAt": "2026-06-04T02:00:00.000Z",
    "active": true
  }
]
```

### User Mappings

```text
data/clickup-user-mappings.json
```

ตัวอย่าง:

```json
[
  {
    "clickupUserId": "12345",
    "clickupName": "Toto",
    "discordUserId": "98765",
    "discordName": "Toto",
    "mappedBy": "111",
    "mappedAt": "2026-06-04T02:00:00.000Z"
  }
]
```

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Start production build:

```bash
npm start
```

On Windows PowerShell, if `npm` is blocked by execution policy, use:

```powershell
npm.cmd run build
```

## Docker

Build image:

```bash
docker build -t taskbot:2.0.2 .
```

Run container:

```bash
docker run -d --name taskbot --restart unless-stopped --env-file .env -e TZ=Asia/Bangkok taskbot:2.0.2
```

## Discord Permissions

Bot ควรมี permission:

```text
View Channel
Send Messages
Send Messages in Threads
Read Message History
Manage Messages
```

`Manage Messages` จำเป็นสำหรับ cleanup ที่ลบข้อความเก่า

## Health Check

```text
GET /discord-bot/health
```

Response:

```json
{
  "ok": true
}
```
