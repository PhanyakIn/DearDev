# Phanyakorn Scripter — ร้านขายซอร์สโค้ด Roblox Studio

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

## โครงสร้าง

```
src/
  pages/        # App, Catalog, News, Contact (หน้าเว็บ)
  components/   # Navbar, Footer, Profile, Detail, ContactProduct, Pointer
  data/         # products.example.js (template ขึ้น GitHub)
  # products.js (ของจริง ไม่ขึ้น GitHub — ต้องสร้างเองจาก .example)
  images/       # รูป public ที่ใช้ร่วมกัน (strip EXIF แล้ว)
  stock/        # รูป/ไฟล์ขายจริง ไม่ขึ้น GitHub (ติด .gitignore)
  css/
public/         # index.html, manifest, icons
```

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
