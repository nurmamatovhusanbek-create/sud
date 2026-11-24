/**
 * The first-time setup guide, ONE source for two readers: the step-by-step reader in Settings › Telegram (`HelpCard`) and `docs/QOLLANMA.md`
 * (written by `bun run guide`, checked by `core/__tests__/setup-guide.test.ts`, so the two never differ). Uzbek, old Latin alphabet, no em dash.
 *
 * A section is: why (`intro`), numbered actions (`steps`, each may carry a `note`: what you see or a tip), an optional table, what to CHECK
 * before going on (`check`) and what to be careful about (`warn`). Plain text only (the reader escapes it); `code` spans are written with backticks.
 */

export interface GuideStep {
  text: string
  /** a tip or what you should see after this action */
  note?: string
}

export interface GuideSection {
  id: string
  title: string
  intro?: string
  steps?: GuideStep[]
  table?: { head: string[]; rows: string[][] }
  /** a small heading above the table, and whether it comes AFTER the steps (a table the steps refer to) */
  tableTitle?: string
  tableAfter?: boolean
  /** a small heading above the steps */
  stepsTitle?: string
  /** a second block of steps with its own heading (a section with two jobs) */
  more?: { title: string; steps: GuideStep[] }
  check?: string
  warn?: string
}

export const GUIDE_TITLE = 'Baza va botni sozlash: qadamma-qadam qoʻllanma'

export const GUIDE_LEAD =
  'Bu qoʻllanma birinchi marta sozlayotgan odam uchun. Qadamlarni tartib bilan bajaring: har bir boʻlimning oxirida «Tekshirish» bor, uni koʻrmay keyingisiga oʻtmang. Hammasi taxminan 30-40 daqiqa oladi.'

export const GUIDE: GuideSection[] = [
  {
    id: 'umumiy',
    title: 'Avval tushunib oling: nima nima bilan bogʻlangan',
    intro:
      'Tizim uch qismdan iborat va ular bitta zanjirda ishlaydi: sud saytlari › ilova (kompyuteringizda) › zaxira (Telegram kanalida) › bot (telefoningizda). Ilova sud saytlaridan maʼlumot yigʻadi va bazaga yozadi. Zaxira: baza shifrlanib, sizning yopiq Telegram kanalingizga yuklanadi. Bot esa shu zaxirani oʻqiydi va telefoningizdan qidirish imkonini beradi. Bot ilovaga bogʻlanmaydi: ilovadagi yangilik botga faqat zaxira orqali yetadi.',
    tableTitle: 'Soʻzlar: nima degani',
    stepsTitle: 'Sizga nima kerak',
    table: {
      head: ['Soʻz', 'Nima degani'],
      rows: [
        ['Baza', 'Kompyuteringizdagi bitta fayl (C:\\Users\\ismingiz\\.sud-tizimi\\sud.db): hamma kompaniya, ish va kvitansiya shu yerda.'],
        ['Zaxira', 'Bazaning shifrlangan nusxasi, Telegram kanalida turadi. Kompyuter buzilsa ham maʼlumot yoʻqolmaydi.'],
        ['Kanal', 'Zaxira turadigan yopiq Telegram kanali. Ikkita boʻladi: asosiy va ehtiyot (mirror).'],
        ['Bot', 'Renderda ishlaydigan dastur: zaxirani oʻqiydi, Telegramda savollaringizga javob beradi va har kuni majlislarni eslatadi.'],
        ['Parol', 'Zaxirani shifrlash kaliti. Ilovada va botda aynan bir xil boʻlishi shart.'],
        ['Render', 'Botni 24 soat ishlatib turadigan bepul xizmat (render.com).'],
      ],
    },
    steps: [
      { text: 'Telegram hisobi (telefoningizda oʻrnatilgan boʻlsin).' },
      { text: 'Ilova oʻrnatilgan kompyuter. Kuzatuv va avtomatik zaxira ishlashi uchun u yoqilgan va ilova ishlab turishi kerak (Sud.bat keep).' },
      { text: 'Render hisobi (bepul) va loyihaning GitHub dagi nusxasi: bot shu yerdan quriladi.' },
      { text: '30-40 daqiqa vaqt va daftar yoki parol menejeri: token va parolni yozib qoʻyish uchun.' },
    ],
  },
  {
    id: 'bot',
    title: 'Telegram bot yaratish',
    intro: 'Bot sizning shaxsiy yordamchingiz: u faqat siz ruxsat bergan odamlarga javob beradi. Uni Telegramning rasmiy @BotFather boti orqali yaratasiz.',
    steps: [
      { text: 'Telegramni oching va qidiruvga @BotFather deb yozing.', note: 'Nomi yonida koʻk galochka boʻlgan rasmiy bot chiqadi. Shuni oching.' },
      { text: '«Start» tugmasini bosing, soʻng /newbot deb yozib yuboring.' },
      { text: 'U botning nomini soʻraydi: istalgan nom yozing, masalan «Sud yordamchi».' },
      { text: 'Keyin username soʻraydi.', note: 'Lotin harflarida va «bot» soʻzi bilan tugashi kerak, masalan sud_mening_bot. Band boʻlsa, boshqa nom sinab koʻring.' },
      { text: 'BotFather «Use this token to access the HTTP API» deb token beradi. Uni nusxalab, daftarga saqlang.', note: 'Token 123456789:AAH... koʻrinishida: raqamlar, ikki nuqta va uzun harf-raqam qatori.' },
    ],
    check: 'Sizda token bor va u daftarda yozilgan.',
    warn: 'Token botning kaliti: uni koʻrgan odam botingizni boshqara oladi. Chatga, skrinshotga, gitga qoʻymang. Tushib ketsa, BotFather ga /revoke yozib yangisini oling.',
  },
  {
    id: 'kanal',
    title: 'Ikkita yopiq kanal yaratish va ularning raqamini topish',
    intro: 'Zaxira kanalda saqlanadi. Ikkita kanal kerak: asosiy va ehtiyot. Bittasi bloklansa yoki oʻchib ketsa, ikkinchisida nusxa qoladi.',
    steps: [
      { text: 'Telegram › yangi xabar (qalam belgisi) › «Yangi kanal».' },
      { text: 'Nomi: «Sud zaxira 1». Tavsif shart emas. «Keyingi» bosing.' },
      { text: 'Turi: «Shaxsiy» (Private). Havola shart emas. Saqlang.', note: 'Hech qachon ochiq (Public) qilmang: zaxira shifrlangan, lekin kanal baribir yopiq boʻlgani yaxshi.' },
      { text: 'Xuddi shunday ikkinchisini «Sud zaxira 2» nomi bilan yarating.' },
      { text: 'Birinchi kanalni oching › nomini bosing › Administratorlar › «Administrator qoʻshish» › qidiruvdan botingizni username bilan toping.' },
      { text: 'Ruxsatlarda «Post messages» (xabar yuborish) va «Pin messages» (xabarni mahkamlash) yoqilgan boʻlsin. Qolganlari kerak emas. Saqlang.', note: '«Pin messages» boʻlmasa, zaxira yuklanadi, lekin bot uni topa olmaydi.' },
      { text: 'Shuni ikkinchi kanalda ham bajaring.' },
      { text: 'Har bir kanalning raqamini (ID) toping: kanalga «salom» deb yozing, shu xabarni @getidsbot ga forward qiling (xabarni bosib turing › Forward).', note: 'U «Forwarded from chat» qatorida -100 bilan boshlanadigan raqam koʻrsatadi, masalan -1002224891668. Ikkala kanal raqamini daftarga yozing.' },
    ],
    check: 'Ikkala kanal uchun -100... raqam yozib olingan va bot ikkala kanalning administratorlar roʻyxatida turibdi.',
    warn: 'Raqamni minus belgisi bilan birga yozing. Telegramning oʻzi kanal raqamini koʻrsatmaydi: shuning uchun @getidsbot kerak.',
  },
  {
    id: 'ilova',
    title: 'Ilovada Telegramni sozlash',
    steps: [
      { text: 'Ilovani oching › chapdagi menyuda «Sozlamalar» › yuqoridagi «Telegram» boʻlimi.' },
      { text: '«Bot tokeni» maydoniga 2-boʻlimdagi tokenni qoʻying.' },
      { text: '«Kanal» maydoniga asosiy kanal raqamini yozing (-100...).' },
      { text: '«Zaxira kanallar» maydoniga ikkinchi kanal raqamini yozing.', note: 'Keyinchalik 3 tagacha zaxira kanal qoʻshish mumkin: raqamlarni vergul bilan ajrating.' },
      { text: '«Saqlash» tugmasini bosing.' },
      { text: '«Sinash» tugmasini bosing. Ilova kanalga kichik fayl yuboradi, uni oʻqiydi va oʻchiradi.', note: 'Har bir qadam yashil belgi bilan chiqishi kerak.' },
      { text: '«Zaxira kanalni sinash» bilan ikkinchi kanalni ham tekshiring.' },
    ],
    check: 'Ikkala sinov ham yashil belgilar bilan tugadi. Qizil belgi chiqsa, yoniga yozilgan sababni oʻqing: odatda botga ruxsat yetishmaydi yoki raqam notoʻgʻri yozilgan.',
    warn: '«Kanalni topish» tugmasi bot Renderda ishlab turganda «webhook is active» xatosini beradi: bu normal, kanal raqamini qoʻlda yozing. Token faqat shu kompyuterda (~/.sud-tizimi/telegram.json) saqlanadi va brauzerga qaytarilmaydi.',
  },
  {
    id: 'parol',
    title: 'Zaxira parolini tanlash',
    intro: 'Zaxira parol bilan shifrlanadi. Parolsiz hech kim, hatto Telegram ham, maʼlumotni oʻqiy olmaydi. Parol ilovada va botda aynan bir xil boʻlishi shart.',
    steps: [
      { text: 'Kamida 10 belgidan iborat parol oʻylab toping.', note: 'Eng yaxshisi uzun ibora: oʻzingiz eslab qoladigan 4-5 ta tasodifiy soʻz va raqam.' },
      { text: 'Uni daftarga yoki parol menejeriga yozib qoʻying.' },
      { text: 'Boshqa joyda ishlatilgan paroldan va chatda yozilgan paroldan foydalanmang.' },
    ],
    check: 'Parol tanlandi va xavfsiz joyda yozib qoʻyilgan.',
    warn: 'Parol yoʻqolsa, zaxirani hech kim qayta ocha olmaydi: uni tiklashning yoʻli yoʻq. Parolni oʻzgartirish alohida ish (16-boʻlim): faqat bitta joyda oʻzgartirib boʻlmaydi.',
  },
  {
    id: 'zaxira',
    title: 'Birinchi zaxirani olish',
    steps: [
      { text: 'Sozlamalar › Telegram sahifasida pastroqqa tushing: «Shifrlangan zaxira» kartasi.' },
      { text: 'Parol maydoniga 5-boʻlimdagi parolni kiriting.' },
      { text: '«Zaxiralash» tugmasini bosing.' },
      { text: 'Jarayon tugaguncha kuting.', note: 'Pastda «Yuklanmoqda: 12/54» kabi sanagich boradi. Katta bazada bir necha daqiqa ketadi; sahifada turish shart emas.' },
      { text: 'Oxirida «Tayyor: 2 ta kanalga zaxira olindi» yozuvi chiqadi.', note: 'Bitta kanalga yuborilmasa «Qisman» deb yozadi va sababini koʻrsatadi.' },
      { text: '«Kanallar holatini tekshirish» tugmasini bosing (parol kiritilgan boʻlsin).' },
    ],
    check: 'Ikkala kanalda ham «toʻliq» yozuvi, zanjir boshlangan sana va soʻnggi zaxira vaqti koʻrinadi.',
  },
  {
    id: 'avto',
    title: 'Avtomatik zaxira',
    intro: 'Har safar «Zaxiralash» ni bosib yurmaslik uchun ilova yangilik paydo boʻlganda zaxirani oʻzi oladi. Yangilik: yangi kvitansiya, topilgan ish, oʻzgargan holat yoki sud roʻyxati.',
    steps: [
      { text: '«Shifrlangan zaxira» kartasida parolni kiriting.' },
      { text: '«Avtomatik zaxirani yoqish» tugmasini bosing.', note: 'Ilova avval parolni kanaldagi zaxira bilan solishtiradi. Notoʻgʻri boʻlsa, yoqmaydi.' },
      { text: 'Belgi «avtomatik zaxira yoqilgan» ga oʻzgarganini koʻring.' },
    ],
    check: '10 daqiqa ichida «Soʻnggi avtomatik zaxira» qatori vaqt bilan paydo boʻladi.',
    warn: 'Buning uchun parol shu kompyuterda shaxsiy faylda (~/.sud-tizimi/backup-pass.json) saqlanadi. Oʻchirsangiz, fayl ham oʻchadi. Ilova har 5 daqiqada tekshiradi, zaxirani 15 daqiqadan tez-tez olmaydi va bills jarayoni ishlayotganda kutadi. Kompyuter oʻchiq boʻlsa, zaxira olinmaydi.',
  },
  {
    id: 'kuzatuv',
    title: 'Kuzatuv: yangi ish haqida Telegramda xabar (ixtiyoriy)',
    intro: 'Yoqilsa, ilova kompaniyalarning sud roʻyxatlarini oʻzi oʻqiydi va yangilik boʻlsa Telegramda xabar yuboradi: sudga yangi ariza, yuqori instansiyaga shikoyat, majlis sanasi oʻzgarishi, ish holati oʻzgarishi.',
    steps: [
      { text: 'Oʻz Telegram ID ingizni bilib oling: @userinfobot ga /start yozing, u «Id» qatorida raqam koʻrsatadi.' },
      { text: 'Sozlamalar › Telegram › pastdagi «Kuzatuv (avtomatik)» kartasi.' },
      { text: '«Xabar oluvchilar» maydoniga ID ingizni yozing (bir nechta boʻlsa, vergul bilan).' },
      { text: '«Kompaniyalar» maydonini boʻsh qoldirsangiz, bazadagi hamma kompaniya kuzatiladi; faqat bir nechtasi kerak boʻlsa, STIR larni vergul bilan yozing.' },
      { text: '«Sinash» tugmasini bosing.', note: 'Telegramda «Kuzatuv: sinov xabari» kelishi kerak. Kelmasa, avval botga /start yozing: bot sizga yozishi uchun siz unga bir marta yozgan boʻlishingiz shart.' },
      { text: '«Yoqish» tugmasini bosing.' },
    ],
    check: 'Sinov xabari Telegramga keldi.',
    warn: 'Birinchi tekshiruv faqat eslab qoladi va xabar yubormaydi (aks holda yuzlab «yangi» ish haqida xabar kelardi). Keyingi tekshiruvlarda faqat haqiqiy yangilik keladi. Tekshiruv har 6 soatda; kompyuter yoqilgan va ilova ishlab turishi kerak.',
  },
  {
    id: 'render',
    title: 'Botni Renderda yaratish (bir marta)',
    intro: 'Bot sizning kompyuteringizda emas, Renderda ishlaydi: shuning uchun kompyuter oʻchiq boʻlsa ham telefoningizdan qidirish mumkin. Botni har kim oʻzi uchun alohida yaratadi va u faqat oʻzi ruxsat bergan odamlarga javob beradi.',
    steps: [
      { text: 'render.com saytida hisob oching (GitHub orqali kirish qulay). Bepul tarif yetadi.' },
      { text: 'Loyihaning kodi GitHub da sizning hisobingizda boʻlishi kerak (loyihani oʻz hisobingizga nusxalang yoki fork qiling): Render kodni shu yerdan oladi.' },
      { text: 'Render › «New» › «Web Service» › «Build and deploy from a Git repository» › «Next» › GitHub ni ulang › loyiha repozitoriysini tanlang › «Connect».' },
      { text: 'Name: istalgan (masalan sud-bot). Region: Frankfurt. Branch: main. Language: Docker.' },
      { text: '«Advanced» ni oching: Dockerfile Path: ./bot/Dockerfile . Docker Build Context Directory: ./bot . Auto-Deploy: No.', note: 'Bu eng koʻp xato qilinadigan joy: kontekst ./bot boʻlmasa, qurish muvaffaqiyatsiz tugaydi.' },
      { text: 'Instance Type: Free.' },
      { text: '«Environment Variables» ostida «Add Environment Variable» bilan pastdagi jadvaldagi oʻzgaruvchilarni birin-ketin qoʻshing (nomi chapda, qiymati oʻngda).' },
      { text: '«Deploy Web Service» tugmasini bosing va 3-6 daqiqa kuting.', note: 'Loglarda «Your service is live» yozuvi chiqadi.' },
    ],
    tableAfter: true,
    tableTitle: '7-qadam uchun: oʻzgaruvchilar',
    table: {
      head: ['Oʻzgaruvchi', 'Nima yoziladi'],
      rows: [
        ['BOT_TOKEN', '2-boʻlimdagi bot tokeni'],
        ['SUD_CHANNEL', 'asosiy,zaxira: ikkala kanal raqami vergul bilan, asosiy birinchi. Masalan -1002224891668,-1001568013790'],
        ['SUD_PASSPHRASE', 'zaxira paroli (ilovadagi bilan aynan bir xil)'],
        ['WEBHOOK_SECRET', 'uzun tasodifiy qator (kamida 30 belgi: harflar va raqamlar)'],
        ['PUBLIC_URL', 'xizmatning https://nom.onrender.com manzili (yaratilgandan keyin qoʻshiladi)'],
        ['ALLOWED_USER_IDS', 'botdan foydalanishi mumkin boʻlganlarning Telegram ID lari (dastlab boʻsh qoldiring: keyingi boʻlimga qarang)'],
      ],
    },
    check: 'Render xizmat sahifasida holat «Live» (yashil).',
    warn: 'Parolni Renderga yozayotganda boʻsh joy yoki ortiqcha belgi qoʻshib yubormang. Parol ilovadagidan bir harf farq qilsa ham bot «Parol notoʻgʻri» deydi.',
  },
  {
    id: 'bot-tekshir',
    title: 'Botni ishga tushirish va tekshirish',
    steps: [
      { text: 'Xizmat sahifasining tepasidagi https://nom.onrender.com manzilini nusxalang va Environment ga PUBLIC_URL sifatida qoʻshing. «Manual Deploy › Deploy latest commit» bosing.' },
      { text: 'Telegramda botingizni oching va unga istalgan xabar yozing (masalan «salom»).', note: 'ALLOWED_USER_IDS hali boʻsh boʻlgani uchun bot «Ruxsat yoʻq. Sizning Telegram ID: 123456789» deb javob beradi.' },
      { text: 'Shu raqamni Render › Environment › ALLOWED_USER_IDS ga yozing (bir nechta odam boʻlsa, vergul bilan) va yana «Manual Deploy › Deploy latest commit» bosing.' },
      { text: 'Brauzerda https://nom.onrender.com/health manzilini oching.', note: '"ready": true va "companies" soni koʻrinishi kerak. Zaxira birinchi marta oʻqilguncha 1-2 daqiqa ketadi; shu vaqtda "ready": false boʻlishi mumkin.' },
      { text: 'Telegramda botga /start yozing: yordam xabari keladi. Chap pastdagi «Qidiruv» tugmasi Mini Appni ochadi.' },
      { text: 'uptimerobot.com da bepul hisob oching, yangi «HTTP(s)» monitor yarating, manzil: https://nom.onrender.com/health , tekshirish oraligʻi: 5 daqiqa.', note: 'Bepul Render xizmati 15 daqiqa soʻrov boʻlmasa uxlab qoladi. Monitor uni uygʻoq tutadi.' },
    ],
    check: '/health da "ready": true, Telegramda /start ga javob bor va /status zaxira sanasini koʻrsatadi.',
    warn: 'Bot faqat ALLOWED_USER_IDS dagilarga javob beradi. Boshqalarga faqat ularning ID sini aytadi va boshqa hech narsa koʻrsatmaydi.',
  },
  {
    id: 'foydalanish',
    title: 'Botdan foydalanish va har kungi eslatma',
    intro: 'Botga shunchaki yozing: ish raqami (2-1004-2603/8020), kvitansiya raqami, STIR yoki kompaniya nomi. U topgan narsalarni tugmalar bilan koʻrsatadi.',
    tableTitle: 'Buyruqlar',
    stepsTitle: 'Har kungi eslatma',
    table: {
      head: ['Buyruq', 'Nima qiladi'],
      rows: [
        ['/hearings [kun] [STIR]', 'Yaqin majlislar (odatda 14 kun). Masalan /hearings 30 yoki /hearings 207275139'],
        ['/stats [STIR]', 'Sonlar: hamma kompaniyalar yoki bitta kompaniyaning sudlar va yillar boʻyicha ishlari'],
        ['/company STIR', 'Kompaniya haqida: nomi, ishlar va kvitansiyalar soni'],
        ['/case raqam', 'Ish: holati, tomonlar, instansiyalar, majlislar, kvitansiyalar'],
        ['/bill raqam', 'Kvitansiya'],
        ['/find matn', 'Qidirish (oddiy xabar yozish bilan bir xil)'],
        ['/app', 'Qidiruv oynasi (Mini App): roʻyxatlar, kompaniya kartalari, majlislar'],
        ['/status', 'Zaxira holati: qachon olingan, nechta yozuv'],
      ],
    },
    steps: [
      { text: 'Har kuni ertalab soat 08:00 dan keyin bot yaqin 7 kunlik majlislar eslatmasini oʻzi yuboradi.', note: 'Majlis boʻlmasa, xabar kelmaydi.' },
      { text: 'Xabarni shunday oʻqing: sarlavha kunni koʻrsatadi (Bugun, Ertaga, sana va hafta kuni); har bir majlis uchun: 🕙 vaqt va ish raqami (bosib nusxalash mumkin), kompaniya nomi va uning tomoni (daʼvogar yoki javobgar), «↔» belgisidan keyin qarshi tomon.' },
      { text: 'Xabar oxiridagi «Majlislar Mini Appʼda» tugmasi hamma majlislarni koʻrsatadi: xabarda faqat dastlabki 12 tasi chiqadi.' },
    ],
    warn: 'Bot sud saytlariga kirmaydi: maʼlumot oxirgi zaxira vaqtidagidek. Xabar oxirida «Maʼlumot ... holatiga» yozuvi shuni koʻrsatadi.',
  },
  {
    id: 'kunlik',
    title: 'Har kungi ish tartibi va kompyuter oʻchiq boʻlsa',
    steps: [
      { text: 'Kompyuterda ilovani yoqib qoʻying: Sud.bat keep.' },
      { text: 'Kompaniyani oching, kerak boʻlsa «Toʻlovlarni yangilash», keyin «Yetishmayotgan ishlarni olish» ni bosing.' },
      { text: 'Avtomatik zaxira yoqilgan boʻlsa, boshqa narsa shart emas: yangilik 15 daqiqa ichida zaxiraga tushadi, bot 5 daqiqa ichida koʻradi. Yoqilmagan boʻlsa, «Zaxiralash» ni qoʻlda bosing.' },
      { text: 'Botda yangilik koʻrinmasa: https://nom.onrender.com/health dagi "backupAt" vaqtini zaxira vaqti bilan solishtiring.' },
    ],
    more: {
      title: 'Kompyuter oʻchiq boʻlsa nima boʻladi?',
      steps: [
        { text: 'Baza fayli kompyuterda qoladi, hech narsa yoʻqolmaydi. Kompyuter va ilova yoqilganda ilova xuddi oʻsha bazadan davom etadi.' },
        { text: 'Ilova oʻchiq paytda hech narsa yangilanmaydi: sud roʻyxatlari oʻqilmaydi, Kuzatuv xabar bermaydi, avtomatik zaxira olinmaydi.' },
        { text: 'Bot ishlayveradi: u Renderda va oxirgi zaxirani koʻrsatadi. Faqat yangiliklar kompyuter yoqilgunicha kelmaydi.' },
      ],
    },
  },
  {
    id: 'kanallar',
    title: 'Yangi zaxira kanal qoʻshish va kanallar holatini koʻrish',
    intro: 'Asosiy kanaldan tashqari 3 tagacha zaxira kanal qoʻshish mumkin, istalgan vaqtda.',
    steps: [
      { text: 'Yangi yopiq kanal yarating va botni uning administratori qiling (3-boʻlim).' },
      { text: 'Sozlamalar › Telegram › «Zaxira kanallar» maydoniga yangi kanal raqamini qoʻshing (vergul bilan) va «Yangilash» bosing.' },
      { text: '«Shifrlangan zaxira» kartasida parolni kiriting va «Zaxiralash» ni bosing.', note: 'Ilova yangi kanalga asosiy kanaldagi hamma narsani oʻzi koʻchiradi.' },
      { text: 'Botning ham shu kanaldan oʻqishini xohlasangiz, Render › Environment › SUD_CHANNEL ga yangi raqamni qoʻshing.' },
      { text: 'Holatni koʻrish: parolni kiriting va «Kanallar holatini tekshirish» ni bosing.', note: 'Har bir kanal uchun: zanjir qaysi sanadan boshlangan, soʻnggi zaxira vaqti, boʻlaklar va kompaniyalar soni, kanaldan oʻchib ketgan fayllar, asosiy kanalda bor-u shu kanalda yoʻq boʻlaklar.' },
    ],
    check: 'Hamma kanal «toʻliq». «Eʼtibor bering» chiqsa, «Zaxiralash» ni bosing: yetishmaganini ilova oʻzi toʻldiradi.',
    warn: 'Yangi kanalning zanjiri uni qoʻshgan sanadan boshlanadi, lekin ichiga bazadagi hamma maʼlumot koʻchiriladi: eski maʼlumot ham unda boʻladi.',
  },
  {
    id: 'tiklash',
    title: 'Yangi kompyuterda tiklash',
    steps: [
      { text: 'Ilovani yangi kompyuterga oʻrnating va ishga tushiring.' },
      { text: 'Sozlamalar › Telegram: bot tokeni va kanal(lar)ni kiriting, «Saqlash».' },
      { text: '«Shifrlangan zaxira» kartasida parolni kiriting va «Kanaldagi kompaniyalar» tugmasini bosing.' },
      { text: 'Kerakli kompaniyalarni tanlab «Tanlanganlarni yuklash» ni bosing.' },
      { text: 'Har bir kompaniyada «Toʻlovlarni yangilash» ni bosing.', note: 'Ish raqamisiz kvitansiyalar zaxiraga kirmaydi: ular shu yerda sud saytidan qayta oʻqiladi.' },
    ],
    check: 'Kompaniyalar roʻyxatda, kvitansiyalar va ishlar bazada.',
  },
  {
    id: 'muammo',
    title: 'Tez-tez uchraydigan muammolar',
    table: {
      head: ['Muammo', 'Sababi va yechimi'],
      rows: [
        ['«Parol notoʻgʻri»', 'Ilovadagi va Renderdagi parol bir xil emas (boʻsh joy yoki bir harf farqi ham). Ikkalasini qaytadan yozing.'],
        ['Bot javob bermayapti', 'https://nom.onrender.com/health ni oching. Ochilmasa, Render xizmati uxlagan yoki toʻxtagan: Renderda holatini va loglarni koʻring. "ready": false boʻlsa, bot zaxirani hali oʻqiyapti: 1-2 daqiqa kuting.'],
        ['«Ruxsat yoʻq. Sizning Telegram ID...»', 'ID ingiz ALLOWED_USER_IDS da yoʻq. Xabardagi raqamni Renderga yozib, qayta joylang.'],
        ['«Kanalni topish» xato beradi', 'Bot webhook ishlatganda shunday boʻladi. Kanal raqamini qoʻlda yozing (3-boʻlim).'],
        ['«Pin messages huquqini bering»', 'Botni kanalda administrator qiling va shu ruxsatni yoqing.'],
        ['Ilovada bitta son, botda boshqa', 'Zaxira hali olinmagan: «Zaxiralash» bosing va 5 daqiqa kuting. Bot, bundan tashqari, hali olinmagan, faqat kvitansiyada nomi bor ishlarni ham sanaydi.'],
        ['Statistika eski sonni koʻrsatadi', 'Statistika kuniga bir marta qayta quriladi. Ish topilganda yoki zaxiradan yuklanganda oʻzi yangilanadi; boshqa holatda «Yangilash» bosing.'],
        ['Toʻlovlar «94 dan 42»', 'Katta kompaniyada ish raqamisiz kvitansiyalar saqlanmaydi (20 000 tadan kichik kompaniyalarda saqlanadi). Bu xato emas.'],
        ['Kuzatuv xabar yubormayapti', 'Kompyuter va ilova yoqilganmi (Sud.bat keep)? «Xabar oluvchilar» da ID bormi? Siz botga kamida bir marta /start yozganmisiz? «Sinash» tugmasi xato sababini koʻrsatadi.'],
      ],
    },
  },
  {
    id: 'parol-almashtirish',
    title: 'Parolni almashtirish',
    intro: 'Parol ikki joyda turadi: ilovada (zaxira olayotganda kiritasiz) va Renderda (SUD_PASSPHRASE). Ikkalasi har doim bir xil boʻlishi kerak: faqat bittasini oʻzgartirsangiz, bot «Parol notoʻgʻri» deydi. Eski kanallardagi zaxira faqat eski parol bilan ochiladi, shuning uchun parolni almashtirish yangi zanjir boshlash demak.',
    steps: [
      { text: 'Faqat parol zaiflashgan boʻlsa almashtiring (masalan, chatga yozilgan boʻlsa). Boshqa hollarda kerak emas.' },
      { text: 'Ikkita yangi yopiq kanal yarating va botni ularda administrator qiling (3-boʻlim).' },
      { text: 'Ilovada: avtomatik zaxirani oʻchiring › yangi kanallarni saqlang › yangi parolni kiriting › «Zaxiralash» ni bosing › avtomatik zaxirani qayta yoqing.' },
      { text: 'Renderda SUD_CHANNEL va SUD_PASSPHRASE ni yangilariga almashtiring va «Manual Deploy» bosing.' },
      { text: '/health da "ready": true va "companies" soni oldingidek ekanini tekshiring.' },
      { text: 'Shundan keyingina eski kanallarni oʻchiring.' },
    ],
    check: 'Bot yangi parol bilan javob beradi, ilovada «Kanallar holatini tekshirish» yangi kanallarni «toʻliq» deb koʻrsatadi.',
  },
  {
    id: 'xavfsizlik',
    title: 'Xavfsizlik, qisqacha',
    steps: [
      { text: 'Token va parolni hech qachon chatga, gitga yoki skrinshotga qoʻymang. Qoʻyib yuborgan boʻlsangiz, tokenni BotFather da /revoke qiling va parolni almashtiring.' },
      { text: 'Parol Renderda saqlanadi: bot uni oʻqiy olishi uchun shu kerak. Render hisobingizga kirishni himoya qiling (ikki bosqichli tasdiqlash).' },
      { text: 'Avtomatik zaxira yoqilsa, parol kompyuteringizda ~/.sud-tizimi/backup-pass.json faylida turadi. Kompyuteringizga ham ruxsatsiz kirishdan himoya qiling.' },
      { text: 'Bot faqat ALLOWED_USER_IDS dagilarga javob beradi. Telegram ID lar roʻyxatini faqat ishonchli odamlar bilan cheklang.' },
    ],
  },
]

/** the guide as Markdown: this is exactly `docs/QOLLANMA.md` */
export function guideMarkdown(): string {
  const out: string[] = [`# ${GUIDE_TITLE}`, '', GUIDE_LEAD, '', 'Ilovaning ichida ham xuddi shu yoʻriqnoma bor: **Sozlamalar › Telegram › «Qanday sozlanadi?»**. Bu fayl shu yoʻriqnomadan avtomatik yoziladi (`bun run guide`): uni qoʻlda tahrir qilmang.', '']
  const steps = (list: GuideStep[]): void => {
    list.forEach((s, i) => {
      out.push(`${i + 1}. ${s.text}`)
      if (s.note) out.push(`   - ${s.note}`)
    })
    out.push('')
  }
  GUIDE.forEach((sec, n) => {
    out.push(`## ${n + 1}. ${sec.title}`, '')
    if (sec.intro) out.push(sec.intro, '')
    const table = (): void => {
      if (!sec.table) return
      if (sec.tableTitle) out.push(`**${sec.tableTitle}**`, '')
      out.push(`| ${sec.table.head.join(' | ')} |`, `|${sec.table.head.map(() => '---').join('|')}|`)
      for (const r of sec.table.rows) out.push(`| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`)
      out.push('')
    }
    if (!sec.tableAfter) table()
    if (sec.steps) {
      if (sec.stepsTitle) out.push(`**${sec.stepsTitle}**`, '')
      steps(sec.steps)
    }
    if (sec.tableAfter) table()
    if (sec.more) {
      out.push(`**${sec.more.title}**`, '')
      steps(sec.more.steps)
    }
    if (sec.check) out.push(`**Tekshirish:** ${sec.check}`, '')
    if (sec.warn) out.push(`> **Diqqat:** ${sec.warn}`, '')
  })
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
