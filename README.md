# DearDev — ร้านขายซอร์สโค้ด Roblox Studio

เว็บร้านขายระบบ/ซอร์สโค้ด Roblox Studio (`.rbxl` / `.rbxm` + license key ต่อออเดอร์)
สร้างด้วย React + Create React App + React Router

> Repo นี้เป็น **public** ได้อย่างปลอดภัย เพราะข้อมูลร้านจริงถูกแยกไว้ในไฟล์ที่ ignore แล้ว
> ดูหัวข้อ [ความปลอดภัย / สิ่งที่ไม่ขึ้น GitHub](#ความปลอดภัย--สิ่งที่ไม่ขึ้น-github)

## เริ่มต้นใช้งาน

```bash
npm install
cp src/data/products.example.js src/data/products.js
npm start
```

เปิด [http://localhost:3000](http://localhost:3000)

> `src/data/products.js` ไม่มีใน repo (ติด `.gitignore`) ต้อง copy จากไฟล์ `.example` ก่อนรันเสมอ
> ใส่รูปสินค้า, ราคา, ลิงก์ YouTube, Discord / Facebook ของร้านในไฟล์นั้น

## Scripts

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm start` | รัน dev mode |
| `npm run build` | build ลง `build/` (ไฟล์นี้ไม่ขึ้น GitHub) |
| `npm test` | รัน test |
| `npm run check:storage` | ตรวจ bucket private + `file_path` + signed URL ก่อนเปิดขาย |
| `npm run check:slipok` | ตรวจ branch/API key + โควต้าคงเหลือ — ใส่ `-- --slip slip.jpg` เพื่อทดสอบสลิปจริง 1 ใบ |
| `npm run check:fulfilment` | พิสูจน์ว่า paid order โหลดได้จริง + cap 3 ครั้งบังคับใช้ (ไม่ใช้เงิน) |
| `npm run smoke` | ทดสอบ pipeline ทั้งเส้น (สร้าง QR + ออเดอร์ แล้วลบทิ้ง) — ใส่ `-- --qr` เพื่อเซฟรูป QR ไว้สแกน |
| `npm run orders -- list pending` | ดู/จัดการออเดอร์ (ทางออกฉุกเฉิน) |

## โครงสร้าง

```
src/
  pages/        # App, Catalog, News, Contact, Product1, Checkout, Success
  components/   # Navbar, Footer, Profile, Detail, ContactProduct, Pointer
  data/         # products.example.js (template ขึ้น GitHub)
  # products.js (ของจริง ไม่ขึ้น GitHub — ต้องสร้างเองจาก .example)
  images/       # รูป public ที่ใช้ร่วมกัน (strip EXIF แล้ว)
  stock/        # รูป/ไฟล์ขายจริง ไม่ขึ้น GitHub (ติด .gitignore)
  lib/          # shopApi, useShop, checkout (เรียก /api/*), youtube
  css/
api/            # Vercel serverless: products, contact, checkout, verify-slip, order, download, health
server/         # โค้ดฝั่ง server (ไม่ถูก bundle เข้า frontend)
  payments/     # promptpay (สร้าง QR), slipok (ตรวจสลิป)
scripts/        # setup-supabase.sh (wizard), orders.js, check-storage.js, check-slipok.js, test-fulfilment.js, smoke-checkout.js
supabase/       # schema.sql (ตาราง + RLS + consume_download)
public/         # index.html, manifest, icons
```

## ระบบสั่งซื้ออัตโนมัติ (PromptPay + ตรวจสลิป)

ลูกค้าจ่ายเงิน → ระบบตรวจสลิปอัตโนมัติ → ปล่อยไฟล์ `.zip` + license key โดยไม่ต้องคุมเอง

```
กดซื้อ → /api/checkout (สร้าง order + PromptPay QR ต่อออเดอร์)
   → ลูกค้าสแกนจ่าย → อัปโหลดสลิป → /api/verify-slip
   → SlipOK ตรวจสลิป +เช็ค 3 ชั้น (ยอด/ผู้รับ/ref ไม่ซ้ำ)
   → mark paid + สุ่ม license key + ส่งอีเมล (Resend)
   → หน้า /success: ปุ่มดาวน์โหลด (สูงสุด 3 ครั้ง) + license key
```

**Endpoint**
| Route | ทำอะไร |
|---|---|
| `POST /api/checkout` | สร้างออเดอร์ + QR (ไม่ปัก QR ถาวร) |
| `POST /api/verify-slip` | ตรวจสลิป + ปล่อยของ (idempotent) |
| `GET /api/order?orderId=` | สถานะออเดอร์สำหรับหน้า success |
| `GET /api/download?orderId=` | signed URL อายุสั้น + จำกัด 3 ครั้ง |

**ต้องตั้งค่าก่อนใช้จริง**
1. รัน SQL ใน `supabase/schema.sql` (ทุก statement เป็น idempotent → รันซ้ำได้)
2. สร้าง Storage bucket **private** ชื่อ `digital-products` แล้วอัปไฟล์ `.zip` เข้าไป
3. ตั้ง `products.file_path` ของแต่ละสินค้าให้ตรงกับชื่อไฟล์ใน bucket เป๊ะ ๆ
4. สมัคร SlipOK → ใส่ `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` **และผูกบัญชีรับเงินใน LINE LIFF**
5. สมัคร Resend → verify domain → ใส่ `RESEND_API_KEY` / `EMAIL_FROM`
6. ตั้ง `PROMPTPAY_PROXY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`

> ใช้ wizard `bash scripts/setup-supabase.sh` เพื่อไล่ทีละขั้น (เขียนค่าลง `.env.local` ให้ด้วย)
> หรือรัน `npm run check:storage` เพื่อยืนยันว่าไฟล์พร้อมขายจริง

**ตั้งค่า SlipOK (ครั้งเดียว)**

1. สมัครผ่าน LINE `@slipok` → เลือกแพ็กเกจ (ฟรี OK Basic = 100 สลิป/เดือน)
2. ใน LINE LIFF เลือกช่องทางตรวจสอบเป็น **API** → จะได้ **Branch ID** (เลขท้าย URL) และ **API Key** (ใน header `x-authorization`)
3. **ผูกบัญชีรับเงิน** ใน LIFF ให้ตรงกับ `PROMPTPAY_PROXY` เป๊ะ ๆ — ไม่ตรงเมื่อไรจะได้ error `1014`
4. ใส่ค่าลง `.env.local`
   ```bash
   SLIPOK_API_KEY=...
   SLIPOK_BRANCH_ID=...
   # ไม่ต้องตั้ง SLIPOK_API_URL — โค้ดมี default ให้แล้ว
   ```
5. ตรวจ: `npm run check:slipok` (ฟรี) → `npm run check:slipok -- --slip slip.jpg` (ใช้ 1 โควต้า)

> `check:slipok` เรียก `/quota` ซึ่งพิสูจน์แค่ว่า branch + key ถูก
> **มีแต่การส่งสลิปจริงเท่านั้นที่พิสูจน์ว่าบัญชีผู้รับผูกถูก** — ควรทำก่อนเปิดขาย

**Environment variables**

| Key | ฝั่ง | หมายเหตุ |
|---|---|---|
| `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` | frontend | เปิดเผยได้ |
| `SUPABASE_URL` | server | ค่าเดียวกับด้านบน |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **ห้าม** ใส่ `REACT_APP_` เด็ดขาด |
| `PROMPTPAY_PROXY` | server | เบอร์โทร 10 หลัก หรือเลขบัตร ปชช. 13 หลัก (**ไม่ใช่เลขบัญชี**) |
| `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` | server | |
| `RESEND_API_KEY` / `EMAIL_FROM` | server | |
| `SITE_URL` | server | ใช้สร้างลิงก์ในอีเมล |
| `DOWNLOAD_LIMIT` | server | จำนวนโหลดสูงสุดต่อออเดอร์ (default 3) |
| `SIGNED_URL_TTL` | server | อายุ signed URL เป็นวินาที (default 300) |
| `QR_TTL_MINUTES` | server | นับถอยหลังบนหน้าเว็บ (default 15) |
| `QR_GRACE_MINUTES` | server | ยังรับสลิปหลัง QR หมดอายุ (default 120) |
| `MAX_VERIFY_ATTEMPTS` | server | จำนวนครั้งตรวจสลิปต่อออเดอร์ (default 12) |
| `CHECKOUT_MAX_PER_WINDOW` | server | จำนวนออเดอร์สูงสุดต่ออีเมลใน `CHECKOUT_WINDOW_MINUTES` |

**สิ่งที่ระบบกันไว้ให้แล้ว**
- QR สร้างใหม่ต่อออเดอร์ → ยอดตรง → ตรวจสลิปแม่น (ไม่ปัก QR ถาวรบนเว็บ)
- สลิปซ้ำถูกบล็อกด้วย unique index บน `slip_ref`
- โหลดเกินโควตาถูกบล็อกด้วย `consume_download()` แบบ atomic
- รูปสลิปถูกย่อในเบราว์เซอร์ก่อนอัปโหลด (กัน Vercel 4.5 MB limit)
- จำกัดจำนวนครั้งตรวจสลิป + จำกัดการสร้างออเดอร์รัว ๆ (ประหยัด credit SlipOK)
- ออเดอร์ที่เลยกำหนดถูกปิดเป็น `expired` ไม่ค้างในคิว

**จัดการออเดอร์ (ทางออกฉุกเฉิน)**

```bash
npm run orders -- stats              # สรุปยอด + จำนวนตามสถานะ
npm run orders -- list pending       # ดูออเดอร์ค้าง
npm run orders -- show <orderId>     # ดูรายละเอียด + ผลตรวจสลิป
npm run orders -- paid <orderId>     # ลูกค้าจ่ายแล้วแต่ระบบยืนยันไม่ได้ → ปล่อยของ + ส่งอีเมล
npm run orders -- expire             # ปิดออเดอร์ค้างที่เลยกำหนด
npm run orders -- prune              # ดูว่าจะลบ/ล้างอะไรได้ (dry run — ไม่แก้อะไร)
npm run orders -- prune --apply      # ลงมือจริง
npm run orders -- prune --apply --days 365   # เก็บ PII ของออเดอร์ paid นานขึ้น
```

### นโยบายการลบข้อมูล

| สถานะ | ทำอะไร | เมื่อไหร่ |
|---|---|---|
| `expired`, `rejected` | **ลบ** | เกิน 30 วัน |
| `pending` | **ลบ** | เกิน 90 วัน |
| `paid`, `refunded` | **ไม่ลบเด็ดขาด** — ล้างแค่ `email` + `slip_payload` | เกิน 180 วัน (ปรับด้วย `--days`) |

**ทำไมไม่ลบ `paid`:**
- `slip_ref` ผูกกับ unique index — ถ้าลบ ใครก็เอาสลิปเดิมมาใช้กับออเดอร์ใหม่ได้
- เป็นหลักฐานเดียวที่มี ถ้าลูกค้าโต้แย้งว่าจ่ายแล้วไม่ได้ของ
- ลิงก์ดาวน์โหลดยังใช้ได้หลังล้าง PII (ลูกค้าเก่ากลับมาโหลดซ้ำได้)

> การลบไม่ทำให้ไฟล์ DB เล็กลงทันที แต่ Postgres เอาพื้นที่ที่คืนมาไปใช้กับแถวใหม่ — ได้ความจุคืนเหมือนกัน

**Troubleshooting**

| อาการ | สาเหตุ/ทางแก้ |
|---|---|
| ไซต์ล่มทั้งเว็บ (ทุกหน้า error) | **Supabase Free pause หลังไม่มี activity 7 วัน** → กด Restore ใน dashboard; กันไว้แล้วด้วย cron `/api/health` รายวันใน `vercel.json` |
| SlipOK error `1014` | ยังไม่ได้ผูกบัญชีรับเงินใน LINE LIFF ของสาขานั้น |
| SlipOK error `1007` | สลิปไม่มี QR (มักเป็น **สลิป TrueMoney / e-wallet**) → ตรวจอัตโนมัติไม่ได้ ใช้ `npm run orders -- paid <id>` |
| ลูกค้าจ่ายผ่าน TrueMoney | เงินเข้าบัญชีจริง แต่สลิป e-wallet ไม่มี QR → ระบบยืนยันไม่ได้ ต้องปล่อยของมือ |
| `Product file not configured` (409) | `products.file_path` ว่าง → รัน `npm run check:storage` |
| อัปสลิปแล้วเงียบ/413 | รูปใหญ่เกิน → ระบบย่อให้แล้ว; ถ้ายังไม่ผ่านให้ใช้ภาพความละเอียดต่ำลง |
| อีเมลไม่ถึงลูกค้า | ยังไม่ verify domain ใน Resend — หน้า `/success` ยังใช้ได้ |
| `Missing PROMPTPAY_PROXY` | ยังไม่ได้ตั้ง env (หรือตั้งบน Vercel แต่ยังไม่ redeploy) |

**ข้อจำกัดเรื่อง TrueMoney Wallet**: ทรูมันนี่สแกนจ่าย QR พร้อมเพย์ได้ (เงินเข้าบัญชีจริง)
แต่สลิปของ e-wallet **ไม่มี QR ให้ตรวจกับธนาคาร** → SlipOK API (ชุดที่เราใช้) ตรวจไม่ได้
จึงไม่ควรโชว์โลโก้ TrueMoney บนหน้าเว็บ และควรบอกลูกค้าให้จ่ายจากแอปธนาคาร

> ทดสอบ local: ใช้ `vercel dev` เพื่อให้ `/api/*` ทำงาน (CRA dev อย่างเดียวจะเรียก API ไม่ได้)

**หมายเหตุเรื่องบัญชีรับเงิน**: ตอนทดสอบใช้บัญชีส่วนตัวได้เลย ก่อนขายจริงแนะนำเปิดบัญชีบุคคลธรรมดาแยกใบ
(คนละธนาคาร) แล้วผูก PromptPay ด้วย **เบอร์สำรอง** เพื่อไม่ให้เบอร์ส่วนตัวหลุดใน QR
พร้อมเพย์ผูกได้ 1 หมายเลข : 1 บัญชี — ย้ายทีหลังทำได้แค่แก้ `PROMPTPAY_PROXY` แล้ว redeploy (ไม่ต้องแก้โค้ด)
แต่อย่าลืมอัปเดตบัญชีรับเงินฝั่ง SlipOK ให้ตรงกัน และย้ายตอนไม่มีออเดอร์ค้าง


## ความปลอดภัย / สิ่งที่ไม่ขึ้น GitHub

`.gitignore` กันไว้แล้ว:

- `src/data/products.js` — ราคา, ลิงก์ Discord/Facebook จริง, ข้อมูลสินค้าจริง
- `src/stock/` — รูปสินค้า, ไฟล์ขาย, QR พร้อมเพย์
- `.env`, `.env.local`, `.env.*.local` — คีย์/รหัสผ่าน (ถ้ามีในอนาคต)
- `/node_modules`, `/build`, `.DS_Store`

เช็คก่อน push ทุกครั้ง:

```bash
git status --short
git check-ignore -v src/data/products.js src/stock/
```

ต้องขึ้น `src/data/products.js` และ `src/stock/` ว่า ignored เสมอ ห้าม `git add -f` สองตัวนี้เด็ดขาด

รูปที่ลง `src/images/` ต้อง strip EXIF + ย่อก่อน commit (กันหลุด GPS/รุ่นมือถือ)

## Deploy

`npm run build` แล้ว deploy โฟลเดอร์ `build/` ขึ้น host ที่ต้องการ (Vercel / Netlify / GitHub Pages ฯลฯ)
อย่าเอาไฟล์ใน `src/stock/` ไปวางบน host สาธารณะตรงๆ ใช้ระบบส่งไฟล์หลังชำระเงินแทน

## License

สงวนลิขสิทธิ์ — ดู `LICENSE`
โค้ด frontend ใน repo นี้ดูได้อย่างเดียว ห้ามก๊อปไปขาย/แจกต่อโดยไม่ได้รับอนุญาต
