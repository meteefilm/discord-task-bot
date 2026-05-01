# 📦 SG Discord ClickUp Bot

Discord Bot สำหรับเชื่อม ClickUp เพื่อ:

- แจ้งเตือน Task เข้า Discord (ตาม thread ที่ผูกไว้)
- ตั้งชื่อ Task อัตโนมัติ
- ตั้ง Due Date ตาม Priority
- สรุปงานรายวัน (Daily Summary)
- ควบคุมผ่าน Slash Commands

---

# 🧠 Architecture


ClickUp → Webhook → Express API → Service → Discord Bot → Channel/Thread
↑
Cron Job (Daily Summary)


---

# 📁 Project Structure


src/
├── bot/
│   ├── client.ts                 # Discord client setup
│   ├── commands.ts               # Slash command definitions
│   └── handlers.ts               # Command & interaction handlers
│
├── routes/
│   └── clickup-webhook.route.ts  # Webhook endpoint (ClickUp → Bot)
│
├── services/
│   ├── clickup.service.ts        # Call ClickUp API
│   ├── project-link.service.ts   # Mapping ClickUp ↔ Discord
│   ├── discord-notify.service.ts # Send message to Discord
│   └── task-summary.service.ts   # Build summary message
│
├── jobs/
│   └── daily-task-summary.job.ts # Cron job (daily summary)
│
├── utils/
│   ├── task-name.util.ts         # Auto rename task
│   ├── due-date.util.ts          # Calculate due date
│   └── date.util.ts              # Format date/time
│
├── types/
│   └── clickup.type.ts           # Type definitions
│
├── data/
│   └── clickup-project-links.json # Stored mappings
│
├── index.ts                      # Entry point (server + bot)
└── .env                          # Environment variables


---

# 🔧 Core Modules

## 🤖 bot/

### `client.ts`
- สร้าง Discord client และ login

### `commands.ts`
- กำหนด Slash Commands

### `handlers.ts`
- จัดการ logic ของ command
- รองรับ autocomplete (folder / list)

---

## 🌐 routes/

### `clickup-webhook.route.ts`
- รับ webhook จาก ClickUp

Flow:

Webhook → getTask → rename → set due → notify Discord


รองรับ:
- ClickUp Webhook (event-based)
- ClickUp Automation (payload-based)

---

## ⚙️ services/

### `clickup.service.ts`
- ติดต่อ ClickUp API

### `project-link.service.ts`
- mapping:

ClickUp List → Discord Channel/Thread


### `discord-notify.service.ts`
- ส่งข้อความเข้า Discord
- รองรับ:
  - channel
  - thread
  - split message (กันเกิน 2000 char)

### `task-summary.service.ts`
- สร้างข้อความสรุปงาน

---

## ⏰ jobs/

### `daily-task-summary.job.ts`
- ใช้ cron ส่ง summary ทุกวัน

---

## 🧰 utils/

### `task-name.util.ts`
- ตั้งชื่อ task อัตโนมัติ

### `due-date.util.ts`
- คำนวณ due date:


urgent → +4 ชม.
high → +1 วัน
normal → +3 วัน
low → +7 วัน


---

## 💾 data/

### `clickup-project-links.json`

เก็บ mapping:

```json
[
  {
    "clickupId": "901817490191",
    "clickupName": "NT Bangrak / PORTAL",
    "channelId": "123",
    "threadId": "456",
    "active": true
  }
]
🔑 Environment Variables
DISCORD_TOKEN=
CLICKUP_TOKEN=
CLICKUP_TEAM_ID=

PORT=8322
TZ=Asia/Bangkok

DAILY_SUMMARY_CRON=0 9 * * *
🌐 Webhook
POST /discord-bot/webhook

ตัวอย่าง:

https://your-domain.com/discord-bot/webhook
🧪 Commands
/clickup link-list     → ผูก ClickUp List กับห้อง/เทรด
/clickup unlink-list   → ยกเลิกการผูก
/clickup links         → ดูรายการที่ผูก
/clickup summary       → สรุปงาน
🔁 Usage Flow
1. เข้า thread หรือ channel
2. ใช้ /clickup link-list
3. เลือก folder + list
4. หลังจากนั้น task ใหม่จะถูกส่งเข้าที่นี่
⏰ Daily Summary
ทุกวันเวลา 09:00

ปรับได้ผ่าน:

DAILY_SUMMARY_CRON=0 9 * * *
⚠️ Important Notes
Discord จำกัด message ≤ 2000 ตัวอักษร
Thread ต้อง join ก่อนส่ง
Bot ต้องมี permission:
Send Messages
Send Messages in Threads
View Channel
🔥 Key Concepts
Webhook = Automation Engine
Command = Control Panel
Cron    = Daily Report
🚀 Future Improvements
Assign task จาก Discord
Mention user จาก assignee
Filter แจ้งเตือนตาม priority
Interactive button (รับงาน)
👨‍💻 Author

SG BOT – ClickUp Integration


---

ถ้าคุณอยากให้ผม:

- ใส่ badge (build / version / docker)
- หรือแยก README เป็น dev / prod
- หรือทำ diagram (draw.io / mermaid)

บอกได้เลย เดี๋ยวจัดให้โหดขึ้นอีก 🔥