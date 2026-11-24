# Baza va botni sozlash: qadamma-qadam qoʻllanma

Bu qoʻllanma birinchi marta sozlayotgan odam uchun. Har bir qadamni tartib bilan bajaring. Ilovaning ichida ham xuddi shu yoʻriqnoma bor:
**Sozlamalar › Telegram › «Qanday sozlanadi?»**.

## Avval tushunib oling (1 daqiqa)

Hammasi bitta zanjir:

```
sud saytlari  →  ilova (kompyuteringiz)  →  zaxira (Telegram kanal)  →  bot (telefoningiz)
```

- **Ilova** kompyuteringizda ishlaydi va hamma maʼlumotni bitta faylda saqlaydi: `C:\Users\<ismingiz>\.sud-tizimi\sud.db`. Bu fayl **baza**.
- **Zaxira**: baza shifrlanib, sizning yopiq Telegram kanalingizga yuklanadi. Telegram faqat maʼnosiz baytlarni koʻradi. Kanal kompyuter buzilsa ham maʼlumotni saqlaydi.
- **Bot** Renderda ishlaydi va shu zaxirani **oʻqiydi**, telefoningizdan qidirish imkonini beradi. Bot sud saytlariga kirmaydi va zaxirani oʻzgartirmaydi.
- **Zaxira paroli** shifrlash kaliti. Ilovada va botda **aynan bir xil** boʻlishi shart. Yoʻqolsa, zaxirani hech kim ocha olmaydi.
- Bot ilovaga bogʻlanmaydi. Ilovada yangilik paydo boʻlsa, u **zaxira** orqali botga yetadi.

## Kerak boʻladi

- Telegram hisobi (telefonda).
- Sud tizimi ilovasi oʻrnatilgan kompyuter (`Sud.bat keep` bilan yoqilgan boʻlsin).
- Render hisobi va ishlayotgan bot (bot allaqachon bor boʻlsa, 6-qadamni oʻtkazib yuboring).

## 1. Telegram bot yaratish

1. Telegramda **@BotFather** ni oching.
2. `/newbot` yozing, botga nom va `...bot` bilan tugaydigan username bering.
3. BotFather **token** beradi (`123456789:AA...` koʻrinishida). Uni nusxalab, xavfsiz joyga qoʻying.
4. Tokenni hech kimga yubormang va chatlarga yozmang. Kimdir koʻrib qolsa, BotFather ichida `/revoke` bilan yangisini oling.

## 2. Ikkita yopiq kanal yaratish

Bittasi asosiy, ikkinchisi ehtiyot nusxa (agar asosiy kanal bloklansa yoki oʻchsa, maʼlumot yoʻqolmaydi).

1. Telegram › **Yangi kanal** › turi **Private** (yopiq). Nomi istalgan, masalan «Sud zaxira 1». Yana bitta: «Sud zaxira 2».
2. **Har ikkala** kanalda botni admin qiling: kanal sozlamalari › Administratorlar › Admin qoʻshish › botingizni tanlang. Ruxsatlardan **«Post messages»** va **«Pin messages»** yoqilgan boʻlsin.
3. Har bir kanalning **raqamini** (ID) toping. U `-100` bilan boshlanadi, masalan `-1002224891668`. Usullar:
   - kanalga biror xabar yozing, keyin shu xabarni **@getidsbot** ga forward qiling, u kanal ID sini koʻrsatadi;
   - yoki kanalni vaqtincha ochiq qilib, `@kanal_nomi` koʻrinishidagi nomdan foydalaning.

## 3. Ilovada sozlash

**Sozlamalar › Telegram**:

1. **Bot tokeni** maydoniga tokenni qoʻying.
2. **Kanal** maydoniga asosiy kanal ID sini yozing.
3. **Zaxira kanallar** maydoniga ikkinchi kanal ID sini yozing (bir nechta boʻlsa, vergul bilan).
4. **Saqlash** tugmasini bosing, keyin **Sinash**. Kanalga kichik fayl yuboriladi, oʻqiladi va oʻchiriladi. Hamma belgi yashil boʻlsa, hammasi joyida.

> **«Kanalni topish» tugmasi** faqat bot webhook ishlatmasa ishlaydi. Bot Renderda ishlab turganda u xato beradi: bunda ID ni yuqoridagidek qoʻlda kiriting. Bu normal.

## 4. Zaxira parolini tanlang

- Kamida 10 belgi. Uzun ibora yaxshi: masalan, 4 ta oʻzingiz bilgan tasodifiy soʻz.
- Daftarga yozib, xavfsiz joyda saqlang. **Yoʻqotsangiz, zaxirani qayta ochib boʻlmaydi.**
- Bir marta tanlab, **hamma joyda aynan shuni** kiriting: ilovada va Renderda.
- Chatlarga yozmang va test parollarni (`sud-test-...`) ishlatmang.

## 5. Birinchi zaxira

**Sozlamalar › Telegram › Shifrlangan zaxira**:

1. Parolni kiriting.
2. **Zaxiralash** tugmasini bosing va tugashini kuting. Katta bazada bir necha daqiqa ketishi mumkin.
3. Oxirida «Tayyor: 2 ta kanalga zaxira olindi» chiqadi. Agar mirror kanal asosiy kanaldan orqada boʻlsa, ilova yetishmagan boʻlaklarni oʻzi koʻchiradi va buni yozadi.
4. **Avtomatik zaxirani yoqish** tugmasi: yoqsangiz, bazada yangilik paydo boʻlganda (yangi kvitansiya, topilgan ish, oʻzgargan holat) ilova zaxirani oʻzi oladi. Buning uchun parol shu kompyuterda shaxsiy faylda saqlanadi. Oʻchirsangiz, fayl ham oʻchadi.

Shu yerning oʻzida **Kuzatuv (avtomatik)** kartasi bor: yoqsangiz, ilova sud roʻyxatlarini oʻzi oʻqiydi va yangi ish, yangi instansiya, majlis oʻzgarishi haqida Telegramdan xabar beradi. Xabar oluvchi sifatida oʻz Telegram ID ingizni yozing (ID ni @userinfobot dan bilib oling).

## 6. Botni Renderda ishga tushirish

(Bot allaqachon ishlayotgan boʻlsa, bu qadam kerak emas.)

Render › xizmat › **Environment** boʻlimida:

| Oʻzgaruvchi | Nima yoziladi |
|---|---|
| `BOT_TOKEN` | 1-qadamdagi token |
| `SUD_CHANNEL` | `-100asosiy,-100zaxira` (asosiy birinchi, vergul bilan) |
| `SUD_PASSPHRASE` | 4-qadamdagi parol (ilovadagi bilan **bir xil**) |
| `ALLOWED_USER_IDS` | botdan foydalanishi mumkin boʻlganlarning Telegram ID lari (vergul bilan) |
| `WEBHOOK_SECRET` | uzun tasodifiy qator |
| `PUBLIC_URL` | xizmatning `https://...onrender.com` manzili |

Saqlang va qayta joylang (Deploy). **Tekshirish:** brauzerda `https://<bot-manzili>/health` oching: `"ready": true` va `companies` soni chiqishi kerak. Keyin Telegramda botga `/start` yozing.

Bepul Render tarifi 15 daqiqadan keyin uxlaydi: uni uygʻoq tutish uchun UptimeRobot kabi xizmatdan `/health` manzilini har 5 daqiqada chaqirtiring.

## 7. Har kungi ish tartibi

1. Kompyuterda `Sud.bat keep` bilan ilovani yoqib qoʻying (Kuzatuv va avtomatik zaxira ishlashi uchun u yoqilgan turishi kerak).
2. Kompaniyani oching, kerak boʻlsa **Toʻlovlarni yangilash**, keyin **Yetishmayotgan ishlarni olish** bosing.
3. Avtomatik zaxira yoqilgan boʻlsa, boshqa hech narsa shart emas: yangilik 15 daqiqa ichida zaxiraga tushadi, bot 5 daqiqa ichida koʻradi. Yoqilmagan boʻlsa, **Zaxiralash** ni qoʻlda bosing.
4. Botda yangilik koʻrinmasa: `https://<bot-manzili>/health` dagi `backupAt` vaqtini zaxira vaqti bilan solishtiring.

## 8. Yangi kompyuterda tiklash

1. Ilovani oʻrnating va ishga tushiring.
2. **Sozlamalar › Telegram**: bot tokeni va kanal(lar)ni kiriting, **Saqlash**.
3. **Shifrlangan zaxira**: parolni kiriting, **Kanaldagi kompaniyalar** tugmasini bosing.
4. Kerakli kompaniyalarni tanlab **Tanlanganlarni yuklash** bosing.
5. Har bir kompaniyada **Toʻlovlarni yangilash** bosing: ish raqamisiz kvitansiyalar zaxiraga kirmaydi va shu yerda qayta oʻqiladi.

## 9. Tez-tez uchraydigan muammolar

| Muammo | Sababi va yechimi |
|---|---|
| «Parol notoʻgʻri» | Ilovadagi va Renderdagi parol bir xil emas (boʻsh joy yoki harf farqi ham). Ikkalasini tekshiring. |
| Bot javob bermayapti | `/health` oching. Ochilmasa, Render xizmati uxlagan yoki toʻxtagan. `ready: false` boʻlsa, bot zaxirani hali oʻqiyapti, 1 daqiqa kuting. |
| «Kanalni topish» xato beradi | Bot webhook ishlatganda shunday boʻladi. Kanal ID sini qoʻlda yozing (3-qadam). |
| «Pin messages huquqini bering» | Botni kanalda admin qilib, shu ruxsatni yoqing. |
| Ilovada bitta son, botda boshqa | Zaxira hali olinmagan: **Zaxiralash** bosing va 5 daqiqa kuting. Bot qidiruvda hali olinmagan, faqat kvitansiyada nomi bor ishlarni ham sanaydi. |
| Statistika eski son koʻrsatadi | Statistika kuniga bir marta qayta quriladi. **Yangilash** bosing. |
| Toʻlovlar «94 dan 42» | Katta kompaniyada ish raqamisiz kvitansiyalar saqlanmaydi (20 000 tadan kichik kompaniyalarda saqlanadi). Bu xato emas. |

## 10. Parolni almashtirish

Parol **ikki joyda** turadi: ilovada (zaxira olayotganda kiritasiz) va Renderda (`SUD_PASSPHRASE`). Ikkalasi **har doim bir xil** boʻlishi kerak. Faqat bittasini oʻzgartirsangiz, bot «Parol notoʻgʻri» deydi.

Eski kanallardagi zaxira faqat eski parol bilan ochiladi, shuning uchun parolni almashtirish yangi zanjir boshlash demak. Faqat parol zaiflashgan boʻlsa (masalan, chatga yozilgan boʻlsa) almashtiring:

1. Ikkita **yangi** yopiq kanal yarating va botni ularda admin qiling (2-qadam).
2. Ilovada: **Avtomatik zaxirani oʻchiring**, yangi kanallarni saqlang, yangi parolni kiriting, **Zaxiralash** bosing, soʻng avtomatik zaxirani qayta yoqing.
3. Renderda `SUD_CHANNEL` va `SUD_PASSPHRASE` ni yangilariga almashtiring va qayta joylang.
4. `/health` da `ready: true` va `companies` soni oldingidek boʻlishini tekshiring. Shundan keyingina eski kanallarni oʻchiring.

## Xavfsizlik, qisqacha

- Token va parolni hech qachon chatga, gitga yoki skrinshotga qoʻymang. Qoʻyib yuborgan boʻlsangiz, tokenni BotFather da `/revoke` qiling va parolni almashtiring.
- Parol Renderda saqlanadi: bot uni oʻqiy olishi uchun shu kerak. Render hisobingizga kirishni himoya qiling.
- Avtomatik zaxira yoqilsa, parol kompyuteringizda `~/.sud-tizimi/backup-pass.json` faylida turadi. Kompyuteringizga ham ruxsatsiz kirishdan himoya qiling.
