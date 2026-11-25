# Baza va botni sozlash: qadamma-qadam qoʻllanma

Bu qoʻllanma birinchi marta sozlayotgan odam uchun. Qadamlarni tartib bilan bajaring: har bir boʻlimning oxirida «Tekshirish» bor, uni koʻrmay keyingisiga oʻtmang. Hammasi taxminan 30-40 daqiqa oladi.

Ilovaning ichida ham xuddi shu yoʻriqnoma bor: **Sozlamalar › Telegram › «Qanday sozlanadi?»**. Bu fayl shu yoʻriqnomadan avtomatik yoziladi (`bun run guide`): uni qoʻlda tahrir qilmang.

## 1. Avval tushunib oling: nima nima bilan bogʻlangan

Tizim uch qismdan iborat va ular bitta zanjirda ishlaydi: sud saytlari › ilova (kompyuteringizda) › zaxira (Telegram kanalida) › bot (telefoningizda). Ilova sud saytlaridan maʼlumot yigʻadi va bazaga yozadi. Zaxira: baza shifrlanib, sizning yopiq Telegram kanalingizga yuklanadi. Bot esa shu zaxirani oʻqiydi va telefoningizdan qidirish imkonini beradi. Bot sud saytlariga kirmaydi: ilovadagi yangilik botga faqat zaxira orqali yetadi. Xohlasangiz, ilova va botni «Bot bilan ulanish» (13-boʻlim) bilan bogʻlaysiz: shunda bot zaxirani darhol oʻqiydi va telefondan kompaniyani yangilatish mumkin.

**Soʻzlar: nima degani**

| Soʻz | Nima degani |
|---|---|
| Baza | Kompyuteringizdagi bitta fayl (C:\Users\ismingiz\.sud-tizimi\sud.db): hamma kompaniya, ish va kvitansiya shu yerda. |
| Zaxira | Bazaning shifrlangan nusxasi, Telegram kanalida turadi. Kompyuter buzilsa ham maʼlumot yoʻqolmaydi. |
| Kanal | Zaxira turadigan yopiq Telegram kanali. Ikkita boʻladi: asosiy va ehtiyot (mirror). |
| Bot | Renderda ishlaydigan dastur: zaxirani oʻqiydi, Telegramda savollaringizga javob beradi va har kuni majlislarni eslatadi. |
| Parol | Zaxirani shifrlash kaliti. Ilovada va botda aynan bir xil boʻlishi shart. |
| Render | Botni 24 soat ishlatib turadigan bepul xizmat (render.com). |

**Sizga nima kerak**

1. Telegram hisobi (telefoningizda oʻrnatilgan boʻlsin).
2. Ilova oʻrnatilgan kompyuter. Kuzatuv va avtomatik zaxira ishlashi uchun u yoqilgan va ilova ishlab turishi kerak (Sud.bat keep).
3. Render hisobi (bepul) va loyihaning GitHub dagi nusxasi: bot shu yerdan quriladi.
4. 30-40 daqiqa vaqt va daftar yoki parol menejeri: token va parolni yozib qoʻyish uchun.

## 2. Telegram bot yaratish

Bot sizning shaxsiy yordamchingiz: u faqat siz ruxsat bergan odamlarga javob beradi. Uni Telegramning rasmiy @BotFather boti orqali yaratasiz.

1. Telegramni oching va qidiruvga @BotFather deb yozing.
   - Nomi yonida koʻk galochka boʻlgan rasmiy bot chiqadi. Shuni oching.
2. «Start» tugmasini bosing, soʻng /newbot deb yozib yuboring.
3. U botning nomini soʻraydi: istalgan nom yozing, masalan «Sud yordamchi».
4. Keyin username soʻraydi.
   - Lotin harflarida va «bot» soʻzi bilan tugashi kerak, masalan sud_mening_bot. Band boʻlsa, boshqa nom sinab koʻring.
5. BotFather «Use this token to access the HTTP API» deb token beradi. Uni nusxalab, daftarga saqlang.
   - Token 123456789:AAH... koʻrinishida: raqamlar, ikki nuqta va uzun harf-raqam qatori.

**Tekshirish:** Sizda token bor va u daftarda yozilgan.

> **Diqqat:** Token botning kaliti: uni koʻrgan odam botingizni boshqara oladi. Chatga, skrinshotga, gitga qoʻymang. Tushib ketsa, BotFather ga /revoke yozib yangisini oling.

## 3. Ikkita yopiq kanal yaratish va ularning raqamini topish

Zaxira kanalda saqlanadi. Ikkita kanal kerak: asosiy va ehtiyot. Bittasi bloklansa yoki oʻchib ketsa, ikkinchisida nusxa qoladi.

1. Telegram › yangi xabar (qalam belgisi) › «Yangi kanal».
2. Nomi: «Sud zaxira 1». Tavsif shart emas. «Keyingi» bosing.
3. Turi: «Shaxsiy» (Private). Havola shart emas. Saqlang.
   - Hech qachon ochiq (Public) qilmang: zaxira shifrlangan, lekin kanal baribir yopiq boʻlgani yaxshi.
4. Xuddi shunday ikkinchisini «Sud zaxira 2» nomi bilan yarating.
5. Birinchi kanalni oching › nomini bosing › Administratorlar › «Administrator qoʻshish» › qidiruvdan botingizni username bilan toping.
6. Ruxsatlarda «Post messages» (xabar yuborish) va «Pin messages» (xabarni mahkamlash) yoqilgan boʻlsin. Qolganlari kerak emas. Saqlang.
   - «Pin messages» boʻlmasa, zaxira yuklanadi, lekin bot uni topa olmaydi.
7. Shuni ikkinchi kanalda ham bajaring.
8. Har bir kanalning raqamini (ID) toping: kanalga «salom» deb yozing, shu xabarni @getidsbot ga forward qiling (xabarni bosib turing › Forward).
   - U «Forwarded from chat» qatorida -100 bilan boshlanadigan raqam koʻrsatadi, masalan -1002224891668. Ikkala kanal raqamini daftarga yozing.

**Tekshirish:** Ikkala kanal uchun -100... raqam yozib olingan va bot ikkala kanalning administratorlar roʻyxatida turibdi.

> **Diqqat:** Raqamni minus belgisi bilan birga yozing. Telegramning oʻzi kanal raqamini koʻrsatmaydi: shuning uchun @getidsbot kerak.

## 4. Ilovada Telegramni sozlash

1. Ilovani oching › chapdagi menyuda «Sozlamalar» › yuqoridagi «Telegram» boʻlimi.
2. «Bot tokeni» maydoniga 2-boʻlimdagi tokenni qoʻying.
3. «Kanal» maydoniga asosiy kanal raqamini yozing (-100...).
4. «Zaxira kanallar» maydoniga ikkinchi kanal raqamini yozing.
   - Keyinchalik 3 tagacha zaxira kanal qoʻshish mumkin: raqamlarni vergul bilan ajrating.
5. «Saqlash» tugmasini bosing.
6. «Sinash» tugmasini bosing. Ilova kanalga kichik fayl yuboradi, uni oʻqiydi va oʻchiradi.
   - Har bir qadam yashil belgi bilan chiqishi kerak.
7. «Zaxira kanalni sinash» bilan ikkinchi kanalni ham tekshiring.

**Tekshirish:** Ikkala sinov ham yashil belgilar bilan tugadi. Qizil belgi chiqsa, yoniga yozilgan sababni oʻqing: odatda botga ruxsat yetishmaydi yoki raqam notoʻgʻri yozilgan.

> **Diqqat:** «Kanalni topish» tugmasi bot Renderda ishlab turganda «webhook is active» xatosini beradi: bu normal, kanal raqamini qoʻlda yozing. Token faqat shu kompyuterda (~/.sud-tizimi/telegram.json) saqlanadi va brauzerga qaytarilmaydi.

## 5. Zaxira parolini tanlash

Zaxira parol bilan shifrlanadi. Parolsiz hech kim, hatto Telegram ham, maʼlumotni oʻqiy olmaydi. Parol ilovada va botda aynan bir xil boʻlishi shart.

1. Kamida 10 belgidan iborat parol oʻylab toping.
   - Eng yaxshisi uzun ibora: oʻzingiz eslab qoladigan 4-5 ta tasodifiy soʻz va raqam.
2. Uni daftarga yoki parol menejeriga yozib qoʻying.
3. Boshqa joyda ishlatilgan paroldan va chatda yozilgan paroldan foydalanmang.

**Tekshirish:** Parol tanlandi va xavfsiz joyda yozib qoʻyilgan.

> **Diqqat:** Parol yoʻqolsa, zaxirani hech kim qayta ocha olmaydi: uni tiklashning yoʻli yoʻq. Parolni oʻzgartirish alohida ish (18-boʻlim): faqat bitta joyda oʻzgartirib boʻlmaydi.

## 6. Birinchi zaxirani olish

1. Sozlamalar › Telegram sahifasida pastroqqa tushing: «Shifrlangan zaxira» kartasi.
2. Parol maydoniga 5-boʻlimdagi parolni kiriting.
3. «Zaxiralash» tugmasini bosing.
4. Jarayon tugaguncha kuting.
   - Pastda «Yuklanmoqda: 12/54» kabi sanagich boradi. Katta bazada bir necha daqiqa ketadi; sahifada turish shart emas.
5. Oxirida «Tayyor: 2 ta kanalga zaxira olindi» yozuvi chiqadi.
   - Bitta kanalga yuborilmasa «Qisman» deb yozadi va sababini koʻrsatadi.
6. «Kanallar holatini tekshirish» tugmasini bosing (parol kiritilgan boʻlsin).

**Tekshirish:** Ikkala kanalda ham «toʻliq» yozuvi, zanjir boshlangan sana va soʻnggi zaxira vaqti koʻrinadi.

## 7. Avtomatik zaxira

Har safar «Zaxiralash» ni bosib yurmaslik uchun ilova yangilik paydo boʻlganda zaxirani oʻzi oladi. Yangilik: yangi kvitansiya, topilgan ish, oʻzgargan holat yoki sud roʻyxati.

1. «Shifrlangan zaxira» kartasida parolni kiriting.
2. «Avtomatik zaxirani yoqish» tugmasini bosing.
   - Ilova avval parolni kanaldagi zaxira bilan solishtiradi. Notoʻgʻri boʻlsa, yoqmaydi.
3. Belgi «avtomatik zaxira yoqilgan» ga oʻzgarganini koʻring.

**Tekshirish:** 10 daqiqa ichida «Soʻnggi avtomatik zaxira» qatori vaqt bilan paydo boʻladi.

> **Diqqat:** Buning uchun parol shu kompyuterda shaxsiy faylda (~/.sud-tizimi/backup-pass.json) saqlanadi. Oʻchirsangiz, fayl ham oʻchadi. Ilova har 5 daqiqada tekshiradi, zaxirani 15 daqiqadan tez-tez olmaydi va bills jarayoni ishlayotganda kutadi. Kompyuter oʻchiq boʻlsa, zaxira olinmaydi.

## 8. Kuzatuv: yangi ish haqida Telegramda xabar (ixtiyoriy)

Yoqilsa, ilova kompaniyalarning sud roʻyxatlarini oʻzi oʻqiydi va yangilik boʻlsa Telegramda xabar yuboradi: sudga yangi ariza, yuqori instansiyaga shikoyat, majlis sanasi oʻzgarishi, ish holati oʻzgarishi.

1. Oʻz Telegram ID ingizni bilib oling: @userinfobot ga /start yozing, u «Id» qatorida raqam koʻrsatadi.
2. Sozlamalar › Telegram › pastdagi «Kuzatuv (avtomatik)» kartasi.
3. «Xabar oluvchilar» maydoniga ID ingizni yozing (bir nechta boʻlsa, vergul bilan).
4. «Kompaniyalar» maydonini boʻsh qoldirsangiz, bazadagi hamma kompaniya kuzatiladi; faqat bir nechtasi kerak boʻlsa, STIR larni vergul bilan yozing.
5. «Sinash» tugmasini bosing.
   - Telegramda «Kuzatuv: sinov xabari» kelishi kerak. Kelmasa, avval botga /start yozing: bot sizga yozishi uchun siz unga bir marta yozgan boʻlishingiz shart.
6. «Yoqish» tugmasini bosing.

**Tekshirish:** Sinov xabari Telegramga keldi.

> **Diqqat:** Birinchi tekshiruv faqat eslab qoladi va xabar yubormaydi (aks holda yuzlab «yangi» ish haqida xabar kelardi). Keyingi tekshiruvlarda faqat haqiqiy yangilik keladi. Tekshiruv har 6 soatda; kompyuter yoqilgan va ilova ishlab turishi kerak.

## 9. Botni Renderda yaratish (bir marta)

Bot sizning kompyuteringizda emas, Renderda ishlaydi: shuning uchun kompyuter oʻchiq boʻlsa ham telefoningizdan qidirish mumkin. Botni har kim oʻzi uchun alohida yaratadi va u faqat oʻzi ruxsat bergan odamlarga javob beradi.

1. render.com saytida hisob oching (GitHub orqali kirish qulay). Bepul tarif yetadi.
2. Loyihaning kodi GitHub da sizning hisobingizda boʻlishi kerak (loyihani oʻz hisobingizga nusxalang yoki fork qiling): Render kodni shu yerdan oladi.
3. Render › «New» › «Web Service» › «Build and deploy from a Git repository» › «Next» › GitHub ni ulang › loyiha repozitoriysini tanlang › «Connect».
4. Name: istalgan (masalan sud-bot). Region: Frankfurt. Branch: main. Language: Docker.
5. «Advanced» ni oching: Dockerfile Path: ./bot/Dockerfile . Docker Build Context Directory: ./bot . Auto-Deploy: No.
   - Bu eng koʻp xato qilinadigan joy: kontekst ./bot boʻlmasa, qurish muvaffaqiyatsiz tugaydi.
6. Instance Type: Free.
7. «Environment Variables» ostida «Add Environment Variable» bilan pastdagi jadvaldagi oʻzgaruvchilarni birin-ketin qoʻshing (nomi chapda, qiymati oʻngda).
8. «Deploy Web Service» tugmasini bosing va 3-6 daqiqa kuting.
   - Loglarda «Your service is live» yozuvi chiqadi.

**7-qadam uchun: oʻzgaruvchilar**

| Oʻzgaruvchi | Nima yoziladi |
|---|---|
| BOT_TOKEN | 2-boʻlimdagi bot tokeni |
| SUD_CHANNEL | asosiy,zaxira: ikkala kanal raqami vergul bilan, asosiy birinchi. Masalan -1002224891668,-1001568013790 |
| SUD_PASSPHRASE | zaxira paroli (ilovadagi bilan aynan bir xil) |
| WEBHOOK_SECRET | uzun tasodifiy qator (kamida 30 belgi: harflar va raqamlar) |
| PUBLIC_URL | xizmatning https://nom.onrender.com manzili (yaratilgandan keyin qoʻshiladi) |
| ALLOWED_USER_IDS | botdan foydalanishi mumkin boʻlganlarning Telegram ID lari (dastlab boʻsh qoldiring: keyingi boʻlimga qarang) |

**Tekshirish:** Render xizmat sahifasida holat «Live» (yashil).

> **Diqqat:** Parolni Renderga yozayotganda boʻsh joy yoki ortiqcha belgi qoʻshib yubormang. Parol ilovadagidan bir harf farq qilsa ham bot «Parol notoʻgʻri» deydi.

## 10. Botni ishga tushirish va tekshirish

1. Xizmat sahifasining tepasidagi https://nom.onrender.com manzilini nusxalang va Environment ga PUBLIC_URL sifatida qoʻshing. «Manual Deploy › Deploy latest commit» bosing.
2. Telegramda botingizni oching va unga istalgan xabar yozing (masalan «salom»).
   - ALLOWED_USER_IDS hali boʻsh boʻlgani uchun bot «Ruxsat yoʻq. Sizning Telegram ID: 123456789» deb javob beradi.
3. Shu raqamni Render › Environment › ALLOWED_USER_IDS ga yozing (bir nechta odam boʻlsa, vergul bilan) va yana «Manual Deploy › Deploy latest commit» bosing.
4. Brauzerda https://nom.onrender.com/health manzilini oching.
   - "ready": true va "companies" soni koʻrinishi kerak. Zaxira birinchi marta oʻqilguncha 1-2 daqiqa ketadi; shu vaqtda "ready": false boʻlishi mumkin.
5. Telegramda botga /start yozing: yordam xabari keladi. Chap pastdagi «Qidiruv» tugmasi Mini Appni ochadi.
6. uptimerobot.com da bepul hisob oching, yangi «HTTP(s)» monitor yarating, manzil: https://nom.onrender.com/health , tekshirish oraligʻi: 5 daqiqa.
   - Bepul Render xizmati 15 daqiqa soʻrov boʻlmasa uxlab qoladi. Monitor uni uygʻoq tutadi.

**Tekshirish:** /health da "ready": true, Telegramda /start ga javob bor va /status zaxira sanasini koʻrsatadi.

> **Diqqat:** Bot faqat ALLOWED_USER_IDS dagilarga javob beradi. Boshqalarga faqat ularning ID sini aytadi va boshqa hech narsa koʻrsatmaydi.

## 11. Botdan foydalanish va har kungi eslatma

Botga shunchaki yozing: ish raqami (2-1004-2603/8020), kvitansiya raqami, STIR yoki kompaniya nomi. U topgan narsalarni tugmalar bilan koʻrsatadi.

**Buyruqlar**

| Buyruq | Nima qiladi |
|---|---|
| /hearings [kun] [STIR] | Yaqin majlislar (odatda 14 kun). Masalan /hearings 30 yoki /hearings 207275139 |
| /stats [STIR] | Sonlar: hamma kompaniyalar yoki bitta kompaniyaning sudlar va yillar boʻyicha ishlari |
| /company STIR | Kompaniya haqida: nomi, ishlar va kvitansiyalar soni |
| /case raqam | Ish: holati, tomonlar, instansiyalar, majlislar, kvitansiyalar |
| /bill raqam | Kvitansiya |
| /find matn | Qidirish (oddiy xabar yozish bilan bir xil) |
| /app | Qidiruv oynasi (Mini App): roʻyxatlar, kompaniya kartalari, majlislar |
| /settings | Eslatma sozlamalari: vaqt, kunlar soni, kompaniyalar (12-boʻlim) |
| /orders ish raqami yoki STIR | Sud qarorlari: har instansiya alohida tugma, bosilsa PDF keladi. Hali yuklanmagan qarorda «yuklash» tugmasi bor: ilova (yoqilgan boʻlsa) uni yuklaydi va bot faylni yuboradi; sayt odam tasdiqlashini talab qilsa, bot sababini yozadi. Ish kartasida «Qarorlar» tugmasi ham bor |
| /refresh STIR | Kompaniyani sud saytlaridan qayta yigʻdirish (ilova bilan ulanish yoqilgan boʻlsa, 13-boʻlim) |
| /status | Zaxira holati: qachon olingan, nechta yozuv |

**Har kungi eslatma**

1. Bot ikkita eslatma yuboradi: ertalab yaqin kunlardagi majlislar va kechqurun ertangi majlislar.
   - Standart vaqt: ertalab 08:00 (keyingi 7 kun), kechqurun 18:00 (faqat ertangi kun). Majlis boʻlmasa, xabar kelmaydi. Vaqtni 12-boʻlimda oʻzingiz oʻzgartirasiz.
2. Xabarni shunday oʻqing: sarlavha kunni koʻrsatadi (Bugun, Ertaga, sana va hafta kuni); har bir majlis uchun: 🕙 vaqt va ish raqami (bosib nusxalash mumkin), kompaniya nomi va uning tomoni (daʼvogar yoki javobgar), «↔» belgisidan keyin qarshi tomon.
3. Xabar oxiridagi «Majlislar Mini Appʼda» tugmasi hamma majlislarni koʻrsatadi: xabarda faqat dastlabki 12 tasi chiqadi.

> **Diqqat:** Bot sud saytlariga kirmaydi: maʼlumot oxirgi zaxira vaqtidagidek. Xabar oxirida «Maʼlumot ... holatiga» yozuvi shuni koʻrsatadi.

## 12. Eslatmalarni sozlash: vaqt, kunlar va kompaniyalar

Har bir odam eslatmalarini oʻzi uchun sozlaydi: bu boshqa odamning sozlamasiga taʼsir qilmaydi. Standart: ertalab 08:00 (keyingi 7 kun) va kechqurun 18:00 (ertangi kun), hamma kompaniyalar haqida.

1. Botga /settings deb yozing.
   - Bot sozlamalar oynasini yuboradi va uni chatda mahkamlaydi.
2. «Ertalab» qatorida vaqtni tanlang (07:00, 08:00 yoki 09:00) yoki eslatmani butunlay oʻchirish uchun «Oʻchiq» ni bosing.
3. «Kechqurun» qatorida vaqtni tanlang (17:00 dan 20:00 gacha) yoki «Oʻchiq» ni bosing.
4. Ertalabki eslatma necha kunni koʻrsatishini tanlang: 3, 7, 14 yoki 30 kun.
   - Kechki eslatma har doim faqat ertangi kunni koʻrsatadi.
5. «Kompaniyalar» qatorida «Hammasi» ni qoldiring yoki kerakli kompaniyalarni belgilang.
   - Bir nechtasini belgilash mumkin. Hammasini belgilasangiz, «Hammasi» boʻlib qoladi. Birortasini belgilamasangiz ham «Hammasi».
6. Tanlovni tasdiqlash shart emas: har bir tugma darhol saqlanadi va oyna oʻzi yangilanadi.

**Tekshirish:** Oynadagi matn tanlovingizni koʻrsatadi, masalan «Kechki eslatma: 20:00 · ertangi majlislar». Tanlangan tugmada ✓ belgisi turadi.

> **Diqqat:** Sozlamalar sizning chatingizdagi mahkamlangan oynaning ichida saqlanadi (bot joylashgan serverda fayl saqlanmaydi, qayta ishga tushganda yoʻqoladi). Shu mahkamlangan xabarni oʻchirmang va chatda boshqa xabarni mahkamlamang: aks holda sozlamalar standartga qaytadi. Vaqt Oʻzbekiston vaqti (UTC+5) bilan.

## 13. Ilova va botni bogʻlash: darhol yangilanish va /refresh

Bogʻlamasangiz ham hammasi ishlaydi: bot zaxirani 5 daqiqada bir marta oʻzi tekshiradi. Bogʻlasangiz ikkita narsa qoʻshiladi: (1) ilova zaxira olishi bilan botga xabar beradi va bot darhol oʻqiydi; (2) telefondan botga /refresh STIR deb yozsangiz, ilova shu kompaniyani sud saytlaridan qayta oʻqiydi, zaxiraga yozadi va bot sizga natijani yozadi. Ilova botga oʻzi murojaat qiladi: kompyuterda hech qanday port ochilmaydi, internetdan unga hech kim kira olmaydi.

1. Avtomatik zaxira yoqilgan boʻlsin (7-boʻlim).
   - Telefondan soʻralgan yangilanish zaxiraga shu orqali yoziladi. Yoqilmagan boʻlsa, bot «zaxira yoqilmagan» deb javob beradi.
2. Sozlamalar › Telegram › «Bot bilan ulanish» kartasiga botning manzilini yozing, masalan https://nom.onrender.com (Render sahifasining tepasidagi manzil).
   - Faqat https:// bilan boshlanadigan manzil qabul qilinadi; oxiridagi /app yoki boshqa qismi shart emas.
3. «Ulanishni yoqish» ni bosing.
   - Bot uxlab qolgan boʻlsa, uygʻonishi bir daqiqagacha oladi.
4. Telefondan botga yozing: /refresh 207275139 (oʻz kompaniyangiz STIRi).
5. Bot «navbatga qoʻyildi» deydi. Bir necha daqiqadan soʻng u «yangilandi» deb ish va toʻlovlar sonini yozadi.
   - Bir vaqtning oʻzida har kimdan uchtagacha kompaniya soʻrash mumkin; yaqinda yangilangan kompaniya 5 daqiqa ichida qayta soʻralmaydi.

**Tekshirish:** Kartada «ulangan» yozuvi chiqadi va «Botdan soʻnggi javob» vaqti har daqiqada yangilanib turadi. Botga /refresh yozsangiz, «navbatga qoʻyildi» javobi keladi.

> **Diqqat:** Ulanish faqat kompyuter yoqilgan va ilova ishlab turganda ishlaydi (Sud.bat keep). Oʻchiq boʻlsa, bot «Ilova ulanmagan» deb javob beradi: hech narsa yoʻqolmaydi, faqat yangilanmaydi. Imzo bot tokeniga bogʻliq: tokenni oʻzgartirsangiz, ilovada ham yangi tokenni saqlang.

## 14. Har kungi ish tartibi va kompyuter oʻchiq boʻlsa

1. Kompyuterda ilovani yoqib qoʻying: Sud.bat keep.
2. Kompaniyani oching, kerak boʻlsa «Toʻlovlarni yangilash», keyin «Yetishmayotgan ishlarni olish» ni bosing.
3. Avtomatik zaxira yoqilgan boʻlsa, boshqa narsa shart emas: yangilik 15 daqiqa ichida zaxiraga tushadi, bot 5 daqiqa ichida koʻradi. Yoqilmagan boʻlsa, «Zaxiralash» ni qoʻlda bosing.
4. Botda yangilik koʻrinmasa: https://nom.onrender.com/health dagi "backupAt" vaqtini zaxira vaqti bilan solishtiring.

**Kompyuter oʻchiq boʻlsa nima boʻladi?**

1. Baza fayli kompyuterda qoladi, hech narsa yoʻqolmaydi. Kompyuter va ilova yoqilganda ilova xuddi oʻsha bazadan davom etadi.
2. Ilova oʻchiq paytda hech narsa yangilanmaydi: sud roʻyxatlari oʻqilmaydi, Kuzatuv xabar bermaydi, avtomatik zaxira olinmaydi.
3. Bot ishlayveradi: u Renderda va oxirgi zaxirani koʻrsatadi. Faqat yangiliklar kompyuter yoqilgunicha kelmaydi.

## 15. Yangi zaxira kanal qoʻshish va kanallar holatini koʻrish

Asosiy kanaldan tashqari 3 tagacha zaxira kanal qoʻshish mumkin, istalgan vaqtda.

1. Yangi yopiq kanal yarating va botni uning administratori qiling (3-boʻlim).
2. Sozlamalar › Telegram › «Zaxira kanallar» maydoniga yangi kanal raqamini qoʻshing (vergul bilan) va «Yangilash» bosing.
3. «Shifrlangan zaxira» kartasida parolni kiriting va «Zaxiralash» ni bosing.
   - Ilova yangi kanalga asosiy kanaldagi hamma narsani oʻzi koʻchiradi.
4. Botning ham shu kanaldan oʻqishini xohlasangiz, Render › Environment › SUD_CHANNEL ga yangi raqamni qoʻshing.
5. Holatni koʻrish: parolni kiriting va «Kanallar holatini tekshirish» ni bosing.
   - Har bir kanal uchun: zanjir qaysi sanadan boshlangan, soʻnggi zaxira vaqti, boʻlaklar va kompaniyalar soni, kanaldan oʻchib ketgan fayllar, asosiy kanalda bor-u shu kanalda yoʻq boʻlaklar.

**Tekshirish:** Hamma kanal «toʻliq». «Eʼtibor bering» chiqsa, «Zaxiralash» ni bosing: yetishmaganini ilova oʻzi toʻldiradi.

> **Diqqat:** Yangi kanalning zanjiri uni qoʻshgan sanadan boshlanadi, lekin ichiga bazadagi hamma maʼlumot koʻchiriladi: eski maʼlumot ham unda boʻladi.

## 16. Yangi kompyuterda tiklash

1. Ilovani yangi kompyuterga oʻrnating va ishga tushiring.
2. Sozlamalar › Telegram: bot tokeni va kanal(lar)ni kiriting, «Saqlash».
3. «Shifrlangan zaxira» kartasida parolni kiriting va «Kanaldagi kompaniyalar» tugmasini bosing.
4. Kerakli kompaniyalarni tanlab «Tanlanganlarni yuklash» ni bosing.
5. Har bir kompaniyada «Toʻlovlarni yangilash» ni bosing.
   - Ish raqamisiz kvitansiyalar zaxiraga kirmaydi: ular shu yerda sud saytidan qayta oʻqiladi.

**Tekshirish:** Kompaniyalar roʻyxatda, kvitansiyalar va ishlar bazada.

## 17. Tez-tez uchraydigan muammolar

| Muammo | Sababi va yechimi |
|---|---|
| «Parol notoʻgʻri» | Ilovadagi va Renderdagi parol bir xil emas (boʻsh joy yoki bir harf farqi ham). Ikkalasini qaytadan yozing. |
| Bot javob bermayapti | https://nom.onrender.com/health ni oching. Ochilmasa, Render xizmati uxlagan yoki toʻxtagan: Renderda holatini va loglarni koʻring. "ready": false boʻlsa, bot zaxirani hali oʻqiyapti: 1-2 daqiqa kuting. |
| «Ruxsat yoʻq. Sizning Telegram ID...» | ID ingiz ALLOWED_USER_IDS da yoʻq. Xabardagi raqamni Renderga yozib, qayta joylang. |
| «Kanalni topish» xato beradi | Bot webhook ishlatganda shunday boʻladi. Kanal raqamini qoʻlda yozing (3-boʻlim). |
| «Pin messages huquqini bering» | Botni kanalda administrator qiling va shu ruxsatni yoqing. |
| Ilovada bitta son, botda boshqa | Zaxira hali olinmagan: «Zaxiralash» bosing va 5 daqiqa kuting. Bot, bundan tashqari, hali olinmagan, faqat kvitansiyada nomi bor ishlarni ham sanaydi. |
| Statistika eski sonni koʻrsatadi | Statistika kuniga bir marta qayta quriladi. Ish topilganda yoki zaxiradan yuklanganda oʻzi yangilanadi; boshqa holatda «Yangilash» bosing. |
| Toʻlovlar «94 dan 42» | Katta kompaniyada ish raqamisiz kvitansiyalar saqlanmaydi (20 000 tadan kichik kompaniyalarda saqlanadi). Bu xato emas. |
| Eslatma kelmayapti | /settings da eslatma «Oʻchiq» emasligini va tanlangan kompaniyalarni tekshiring. Majlis boʻlmasa, xabar kelmaydi. ID ingiz ALLOWED_USER_IDS da bormi? Bot uygʻoqmi (/health)? Zaxira oʻqilganmi (/status)? |
| Kuzatuv xabar yubormayapti | Kompyuter va ilova yoqilganmi (Sud.bat keep)? «Xabar oluvchilar» da ID bormi? Siz botga kamida bir marta /start yozganmisiz? «Sinash» tugmasi xato sababini koʻrsatadi. |

## 18. Parolni almashtirish

Parol ikki joyda turadi: ilovada (zaxira olayotganda kiritasiz) va Renderda (SUD_PASSPHRASE). Ikkalasi har doim bir xil boʻlishi kerak: faqat bittasini oʻzgartirsangiz, bot «Parol notoʻgʻri» deydi. Eski kanallardagi zaxira faqat eski parol bilan ochiladi, shuning uchun parolni almashtirish yangi zanjir boshlash demak.

1. Faqat parol zaiflashgan boʻlsa almashtiring (masalan, chatga yozilgan boʻlsa). Boshqa hollarda kerak emas.
2. Ikkita yangi yopiq kanal yarating va botni ularda administrator qiling (3-boʻlim).
3. Ilovada: avtomatik zaxirani oʻchiring › yangi kanallarni saqlang › yangi parolni kiriting › «Zaxiralash» ni bosing › avtomatik zaxirani qayta yoqing.
4. Renderda SUD_CHANNEL va SUD_PASSPHRASE ni yangilariga almashtiring va «Manual Deploy» bosing.
5. /health da "ready": true va "companies" soni oldingidek ekanini tekshiring.
6. Shundan keyingina eski kanallarni oʻchiring.

**Tekshirish:** Bot yangi parol bilan javob beradi, ilovada «Kanallar holatini tekshirish» yangi kanallarni «toʻliq» deb koʻrsatadi.

## 19. Xavfsizlik, qisqacha

1. Token va parolni hech qachon chatga, gitga yoki skrinshotga qoʻymang. Qoʻyib yuborgan boʻlsangiz, tokenni BotFather da /revoke qiling va parolni almashtiring.
2. Parol Renderda saqlanadi: bot uni oʻqiy olishi uchun shu kerak. Render hisobingizga kirishni himoya qiling (ikki bosqichli tasdiqlash).
3. Avtomatik zaxira yoqilsa, parol kompyuteringizda ~/.sud-tizimi/backup-pass.json faylida turadi. Kompyuteringizga ham ruxsatsiz kirishdan himoya qiling.
4. Bot faqat ALLOWED_USER_IDS dagilarga javob beradi. Telegram ID lar roʻyxatini faqat ishonchli odamlar bilan cheklang.
