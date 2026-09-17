/**
 * Static court jurisdiction map for Uzbekistan.
 *
 * Maps regions → districts → court IDs for jadval2.sud.uz / jadvalapi.sud.uz.
 * This replaces the 10-ILOVA from lex.uz — no need to fetch it every time.
 *
 * Scraped from jadval2.sud.uz/fib/{region}-dis.html (all 14 regions).
 * Each court ID is used in the API: jadvalapi.sud.uz/vka/{TYPE}/{courtId}/{DDMMYYYY}
 */

export interface CourtEntry {
  id: string       // court ID for the API (e.g. "andtfsud")
  name: string     // court name in Uzbek Cyrillic
  region: string   // region name in Uzbek Cyrillic
}

// All civil courts (fib) by region
const CIVIL_COURTS: CourtEntry[] = [
  // Andijon
  { id: 'andvilfsud', name: 'Андижон вилоят суди', region: 'Андижон вилояти' },
  { id: 'andtfsud', name: 'Андижон туманлараро суди', region: 'Андижон вилояти' },
  { id: 'asaktfsud', name: 'Асака туманлараро суди', region: 'Андижон вилояти' },
  { id: 'boztfsud', name: 'Бўстон туманлараро суди', region: 'Андижон вилояти' },
  { id: 'izbsktfsud', name: 'Избоскан туманлараро суди', region: 'Андижон вилояти' },
  { id: 'kteptfsud', name: 'Қўрғонтепа туманлараро суди', region: 'Андижон вилояти' },
  { id: 'xojaotfsud', name: 'Хўжаобод туманлараро суди', region: 'Андижон вилояти' },
  // Buxoro
  { id: 'buxvilfsud', name: 'Бухоро вилоят суди', region: 'Бухоро вилояти' },
  { id: 'buxtfsud', name: 'Бухоро туманлараро суди', region: 'Бухоро вилояти' },
  { id: 'gijdutfsud', name: 'Ғиждувон туманлараро суди', region: 'Бухоро вилояти' },
  { id: 'kogontfsud', name: 'Когон туманлараро суди', region: 'Бухоро вилояти' },
  { id: 'kkultfsud', name: 'Қоракўл туманлараро суди', region: 'Бухоро вилояти' },
  { id: 'peshtfsud', name: 'Пешку туманлараро суди', region: 'Бухоро вилояти' },
  { id: 'romittfsud', name: 'Ромитон туманлараро суди', region: 'Бухоро вилояти' },
  // Jizzax
  { id: 'jizzavilfsud', name: 'Жиззах вилоят суди', region: 'Жиззах вилояти' },
  { id: 'galortfsud', name: 'Ғаллаорол туманлараро суди', region: 'Жиззах вилояти' },
  { id: 'dusttfsud', name: 'Дўстлик туманлараро суди', region: 'Жиззах вилояти' },
  { id: 'jizzatfsud', name: 'Жиззах туманлараро суди', region: 'Жиззах вилояти' },
  { id: 'zarbtfsudr', name: 'Зарбдор туманлараро суди', region: 'Жиззах вилояти' },
  { id: 'paxtakortfsud', name: 'Пахтакор туман суди', region: 'Жиззах вилояти' },
  { id: 'fortfsud', name: 'Фориш туман суди', region: 'Жиззах вилояти' },
  // Qashqadaryo
  { id: 'kashvilfsud', name: 'Қашқадарё вилоят суди', region: 'Қашқадарё вилояти' },
  { id: 'guzortfsud', name: 'Ғузор туманлараро суди', region: 'Қашқадарё вилояти' },
  { id: 'karshitfsud', name: 'Қарши туманлараро суди', region: 'Қашқадарё вилояти' },
  { id: 'kasbtfsud', name: 'Касби туманлараро суди', region: 'Қашқадарё вилояти' },
  { id: 'kosontfsud', name: 'Косон туманлараро суди', region: 'Қашқадарё вилояти' },
  { id: 'chrkchitfsud', name: 'Чироқчи туман суди', region: 'Қашқадарё вилояти' },
  { id: 'shaxrtfsud', name: 'Шаҳрисабз туманлараро суди', region: 'Қашқадарё вилояти' },
  { id: 'yakbogtfsud', name: 'Яккабоғ туманлараро суди', region: 'Қашқадарё вилояти' },
  // Qoraqalpog'iston
  { id: 'qrfsud', name: 'Қорақалпоғистон Республикаси суди', region: 'Қорақалпоғистон Республикаси' },
  { id: 'amudtfsud', name: 'Амударё туман суди', region: 'Қорақалпоғистон Республикаси' },
  { id: 'bertfsud', name: 'Беруний туманлараро суди', region: 'Қорақалпоғистон Республикаси' },
  { id: 'kungtfsud', name: 'Қўнғирот туманлараро суди', region: 'Қорақалпоғистон Республикаси' },
  { id: 'nuktfsud', name: 'Нукус туманлараро суди', region: 'Қорақалпоғистон Республикаси' },
  { id: 'chimtfsud', name: 'Чимбой туман суди', region: 'Қорақалпоғистон Республикаси' },
  // Navoiy
  { id: 'navvilfsud', name: 'Навоий вилоят суди', region: 'Навоий вилояти' },
  { id: 'zartfsud', name: 'Зарафшон туманлараро суди', region: 'Навоий вилояти' },
  { id: 'navtfsud', name: 'Кармана туманлараро суди', region: 'Навоий вилояти' },
  { id: 'navbxtfsud', name: 'Навбаҳор туманлараро суди', region: 'Навоий вилояти' },
  { id: 'uckutfsud', name: 'Учқудуқ туман суди', region: 'Навоий вилояти' },
  { id: 'xatirchitfsud', name: 'Хатирчи туман суди', region: 'Навоий вилояти' },
  // Namangan
  { id: 'namvilfsud', name: 'Наманган вилоят суди', region: 'Наманган вилояти' },
  { id: 'namtfsud', name: 'Наманган туманлараро суди', region: 'Наманган вилояти' },
  { id: 'uchkurtfsud', name: 'Учқўрғон туманлараро суди', region: 'Наманган вилояти' },
  { id: 'chusttfsud', name: 'Чуст туманлараро суди', region: 'Наманган вилояти' },
  { id: 'yankurtfsud', name: 'Янгиқўрғон туманлараро суди', region: 'Наманган вилояти' },
  // Samarqand
  { id: 'samvilfsud', name: 'Самарқанд вилоят суди', region: 'Самарқанд вилояти' },
  { id: 'jombtfsud', name: 'Жомбой туманлараро суди', region: 'Самарқанд вилояти' },
  { id: 'ishtixtfsud', name: 'Иштихон туманлараро суди', region: 'Самарқанд вилояти' },
  { id: 'kkurgtfsud', name: 'Каттақўрғон туманлараро суди', region: 'Самарқанд вилояти' },
  { id: 'nurobtfsud', name: 'Нуробод туман суди', region: 'Самарқанд вилояти' },
  { id: 'payartfsud', name: 'Пайариқ туманлараро суди', region: 'Самарқанд вилояти' },
  { id: 'pstrconvtfsud', name: 'Пастдарғом туман суди', region: 'Самарқанд вилояти' },
  { id: 'samtfsud', name: 'Самарқанд шаҳар суди', region: 'Самарқанд вилояти' },
  { id: 'tayloktfsud', name: 'Тайлоқ туманлараро суди', region: 'Самарқанд вилояти' },
  { id: 'urguttfsud', name: 'Ургут туман суди', region: 'Самарқанд вилояти' },
  // Sirdaryo
  { id: 'sirdvilfsud', name: 'Сирдарё вилоят суди', region: 'Сирдарё вилояти' },
  { id: 'boyovtfsud', name: 'Боёвут туманлараро суди', region: 'Сирдарё вилояти' },
  { id: 'gulistfsud', name: 'Гулистон туманлараро суди', region: 'Сирдарё вилояти' },
  { id: 'okolttfsud', name: 'Оқолтин туманлараро суди', region: 'Сирдарё вилояти' },
  { id: 'sirdtfsud', name: 'Сирдарё туманлараро суди', region: 'Сирдарё вилояти' },
  // Surxondaryo
  { id: 'surxvilfsud', name: 'Сурхондарё вилоят суди', region: 'Сурхондарё вилояти' },
  { id: 'boystfsud', name: 'Бойсун туман суди', region: 'Сурхондарё вилояти' },
  { id: 'denovtfsud', name: 'Денов туманлараро суди', region: 'Сурхондарё вилояти' },
  { id: 'kumkgtfsud', name: 'Қумқўрғон туманлараро суди', region: 'Сурхондарё вилояти' },
  { id: 'sariostfsud', name: 'Сариосиё туманлараро суди', region: 'Сурхондарё вилояти' },
  { id: 'termtfsud', name: 'Термиз туманлараро суди', region: 'Сурхондарё вилояти' },
  { id: 'sherobtfsud', name: 'Шеробод туманлараро суди', region: 'Сурхондарё вилояти' },
  // Toshkent viloyati
  { id: 'toshvilfsud', name: 'Тошкент вилоят суди', region: 'Тошкент вилояти' },
  { id: 'bekobtfsud', name: 'Бекобод туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'zangtfsud', name: 'Зангиота туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'kuychtfsud', name: 'Қуйичирчиқ туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'oxantfsud', name: 'Оҳангарон туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'urtchtfsud', name: 'Ўртачирчиқ туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'chichtfsud', name: 'Чирчиқ туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'yukchtfsud', name: 'Юқоричирчиқ туманлараро суди', region: 'Тошкент вилояти' },
  { id: 'yangiyultgsud', name: 'Янгийўл туманлараро суди', region: 'Тошкент вилояти' },
  // Toshkent shahar
  { id: 'toshfsud', name: 'Тошкент шаҳар суди', region: 'Тошкент шаҳар' },
  { id: 'mulugtfsud', name: 'Мирзо Улуғбек туманлараро суди', region: 'Тошкент шаҳар' },
  { id: 'mirtfsud', name: 'Миробод туманлараро суди', region: 'Тошкент шаҳар' },
  { id: 'uchttfsud', name: 'Учтепа туманлараро суди', region: 'Тошкент шаҳар' },
  { id: 'shayxtfsud', name: 'Шайхонтоҳур туманлараро суди', region: 'Тошкент шаҳар' },
  { id: 'yakkatfsud', name: 'Яккасарой туманлараро суди', region: 'Тошкент шаҳар' },
  // Farg'ona
  { id: 'fargvilfsud', name: 'Фарғона вилоят суди', region: 'Фарғона вилояти' },
  { id: 'kokantfsud', name: 'Қўқон туманлараро суди', region: 'Фарғона вилояти' },
  { id: 'margiltfsud', name: 'Марғилон туманлараро суди', region: 'Фарғона вилояти' },
  { id: 'rishtontfsud', name: 'Риштон туманлараро суди', region: 'Фарғона вилояти' },
  { id: 'suxtfsud', name: 'Сўх туман суди', region: 'Фарғона вилояти' },
  { id: 'uzbektfsud', name: 'Ўзбекистон туманлараро суди', region: 'Фарғона вилояти' },
  { id: 'fargtfsud', name: 'Фарғона туманлараро суди', region: 'Фарғона вилояти' },
  // Xorazm
  { id: 'xorzvilfsud', name: 'Хоразм вилоят суди', region: 'Хоразм вилояти' },
  { id: 'bogottfsud', name: 'Боғот туманлараро суди', region: 'Хоразм вилояти' },
  { id: 'urgatfsud', name: 'Урганч туманлараро суди', region: 'Хоразм вилояти' },
  { id: 'shovtfsud', name: 'Шовот туманлараро суди', region: 'Хоразм вилояти' },
]

// Region name mapping (Latin → Cyrillic for address matching)
const REGION_MAP: { latin: string; cyrillic: string }[] = [
  { latin: 'andijon', cyrillic: 'Андижон' },
  { latin: 'buxoro', cyrillic: 'Бухоро' },
  { latin: 'jizzax', cyrillic: 'Жиззах' },
  { latin: 'qashqadaryo', cyrillic: 'Қашқадарё' },
  { latin: 'qoraqalpog', cyrillic: 'Қорақалпоғистон' },
  { latin: 'navoiy', cyrillic: 'Навоий' },
  { latin: 'namangan', cyrillic: 'Наманган' },
  { latin: 'samarqand', cyrillic: 'Самарқанд' },
  { latin: 'sirdaryo', cyrillic: 'Сирдарё' },
  { latin: 'surxondaryo', cyrillic: 'Сурхондарё' },
  { latin: 'toshkent vil', cyrillic: 'Тошкент вилоят' },
  { latin: 'toshkent shahar', cyrillic: 'Тошкент шаҳар' },
  { latin: 'fargona', cyrillic: 'Фарғона' },
  { latin: 'xorazm', cyrillic: 'Хоразм' },
]

// District/city → court ID mapping (based on 10-ILOVA structure).
// Maps common district/city names (both Latin and Cyrillic) to their court IDs.
// This is the key lookup that replaces calling lex.uz every time.
const DISTRICT_COURT_MAP: { keywords: string[]; courtId: string }[] = [
  // Andijon
  { keywords: ['andijon shahar', 'andijon sh.', 'андижон шаҳар', 'андижон ш'], courtId: 'andtfsud' },
  { keywords: ['andijon tumani', 'andijon tuman', 'андижон туман'], courtId: 'andtfsud' },
  { keywords: ['asaka', 'асака'], courtId: 'asaktfsud' },
  { keywords: ["bo'ston", 'boston', 'бўстон', 'бостон'], courtId: 'boztfsud' },
  { keywords: ['izboskan', 'избоскан'], courtId: 'izbsktfsud' },
  { keywords: ["qo'rg'ontepa", 'qorgontepa', 'қўрғонтепа', 'хонобод', 'xonobod'], courtId: 'kteptfsud' },
  { keywords: ["xo'jaobod", 'xojaobod', 'хўжаобод'], courtId: 'xojaotfsud' },
  { keywords: ['balikchi', 'baliqchi', 'балиқчи'], courtId: 'andtfsud' },
  { keywords: ['ulugnor', 'uluqnor', 'улуғнор'], courtId: 'andtfsud' },
  { keywords: ['jalaquduq', 'жалақудуқ'], courtId: 'andtfsud' },
  // Buxoro
  { keywords: ['buxoro sh', 'buxoro shahar', 'бухоро ш', 'бухоро шаҳар'], courtId: 'buxtfsud' },
  { keywords: ['buxoro tuman', 'бухоро туман'], courtId: 'buxtfsud' },
  { keywords: ["g'ijduvon", 'gijduvon', 'ғиждувон'], courtId: 'gijdutfsud' },
  { keywords: ['kogon', 'когон'], courtId: 'kogontfsud' },
  { keywords: ["qorako'l", 'qorakol', 'қоракўл'], courtId: 'kkultfsud' },
  { keywords: ['peshku', 'пешку'], courtId: 'peshtfsud' },
  { keywords: ['romiton', 'ромитон'], courtId: 'romittfsud' },
  { keywords: ['shofirkon', 'шофиркон'], courtId: 'buxtfsud' },
  // Jizzax
  { keywords: ["g'allaorol", 'gallaorol', 'ғаллаорол'], courtId: 'galortfsud' },
  { keywords: ["dustlik", 'дўстлик'], courtId: 'dusttfsud' },
  { keywords: ['jizzax sh', 'jizzax shahar', 'жиззах ш', 'жиззах шаҳар'], courtId: 'jizzatfsud' },
  { keywords: ['jizzax tuman', 'жиззах туман'], courtId: 'jizzatfsud' },
  { keywords: ['zarbdor', 'зарбдор'], courtId: 'zarbtfsudr' },
  { keywords: ['paxtakor', 'пахтакор'], courtId: 'paxtakortfsud' },
  { keywords: ['forish', 'фориш'], courtId: 'fortfsud' },
  { keywords: ['mirzacho"l', 'mirzachol', 'мирзачўл'], courtId: 'dusttfsud' },
  // Qashqadaryo
  { keywords: ["g'uzor", 'guzor', 'ғузор'], courtId: 'guzortfsud' },
  { keywords: ['karshi sh', 'qarshi sh', 'қарши ш', 'карши ш'], courtId: 'karshitfsud' },
  { keywords: ['karshi tuman', 'qarshi tuman', 'қарши туман'], courtId: 'karshitfsud' },
  { keywords: ['kasbi', 'касби'], courtId: 'kasbtfsud' },
  { keywords: ['koson', 'косон'], courtId: 'kosontfsud' },
  { keywords: ["chiroqchi", 'чироқчи'], courtId: 'chrkchitfsud' },
  { keywords: ['shahrisabz', 'шаҳрисабз'], courtId: 'shaxrtfsud' },
  { keywords: ["yakkabog'", 'yakkabog', 'яккабоғ'], courtId: 'yakbogtfsud' },
  { keywords: ['kitob', 'китоб'], courtId: 'shaxrtfsud' },
  { keywords: ['dehqonobod', 'dehqonabad', 'деҳконобод'], courtId: 'kasbtfsud' },
  // Qoraqalpog'iston
  { keywords: ['amudaryo', 'амударё'], courtId: 'amudtfsud' },
  { keywords: ['beruniy', 'беруний'], courtId: 'bertfsud' },
  { keywords: ["qo'ng'irot", 'qongirot', 'қўнғирот'], courtId: 'kungtfsud' },
  { keywords: ['nukus sh', 'nukus shahar', 'нукус ш', 'нукус шаҳар'], courtId: 'nuktfsud' },
  { keywords: ['nukus tuman', 'нукус туман'], courtId: 'nuktfsud' },
  { keywords: ['chimboy', 'чимбой'], courtId: 'chimtfsud' },
  { keywords: ['shumanay', 'шуманай'], courtId: 'nuktfsud' },
  { keywords: ['qonliko"l', 'qonlikol', 'қонликўл'], courtId: 'nuktfsud' },
  { keywords: ['turtku"l', 'turtkul', 'тўрткўл'], courtId: 'bertfsud' },
  { keywords: ['mo"ynoq', 'moynoq', 'моўноқ'], courtId: 'nuktfsud' },
  { keywords: ['kegeyli', 'кегейли'], courtId: 'nuktfsud' },
  // Navoiy
  { keywords: ['zarafshon', 'зарафшон'], courtId: 'zartfsud' },
  { keywords: ['karmana', 'кармана'], courtId: 'navtfsud' },
  { keywords: ["navbahor", 'навбаҳор'], courtId: 'navbxtfsud' },
  { keywords: ["uchquduq", 'uchkuduk', 'учқудуқ'], courtId: 'uckutfsud' },
  { keywords: ['xatirchi', 'хатирчи'], courtId: 'xatirchitfsud' },
  { keywords: ['konimex', 'конимех'], courtId: 'navtfsud' },
  // Namangan
  { keywords: ['namangan sh', 'наманган ш', 'наманган шаҳар'], courtId: 'namtfsud' },
  { keywords: ['namangan tuman', 'наманган туман'], courtId: 'namtfsud' },
  { keywords: ["uchqo'rg'on", 'uchqurgon', 'учқўрғон'], courtId: 'uchkurtfsud' },
  { keywords: ['chust', 'чуст'], courtId: 'chusttfsud' },
  { keywords: ["yangiqo'rg'on", 'yangiqurgon', 'янгиқўрғон'], courtId: 'yankurtfsud' },
  { keywords: ['mingbuloq', 'мингбулоқ'], courtId: 'namtfsud' },
  { keywords: ['norin', 'норин'], courtId: 'chusttfsud' },
  { keywords: ['pop', 'поп'], courtId: 'namtfsud' },
  { keywords: ["toraqo'rg'on", 'toraqurgon', 'торақўрғон'], courtId: 'namtfsud' },
  { keywords: ['uychi', 'уйчи'], courtId: 'namtfsud' },
  { keywords: ['kosonsoy', 'косонсой'], courtId: 'chusttfsud' },
  // Samarqand
  { keywords: ['jomboy', 'жомбой'], courtId: 'jombtfsud' },
  { keywords: ['ishtixon', 'иштихон'], courtId: 'ishtixtfsud' },
  { keywords: ["kattaqo'rg'on", 'kattaqurgon', 'каттақўрғон'], courtId: 'kkurgtfsud' },
  { keywords: ['nurobad', 'нуробод'], courtId: 'nurobtfsud' },
  { keywords: ['payariq', 'пайариқ'], courtId: 'payartfsud' },
  { keywords: ["pastdarg'om", 'pastdargon', 'пастдарғом'], courtId: 'pstrconvtfsud' },
  { keywords: ['samarqand sh', 'самарқанд ш', 'самарқанд шаҳар'], courtId: 'samtfsud' },
  { keywords: ['tayloq', 'тайлоқ'], courtId: 'tayloktfsud' },
  { keywords: ['urgut', 'ургут'], courtId: 'urguttfsud' },
  { keywords: ['bulungur', 'булунғур'], courtId: 'ishtixtfsud' },
  { keywords: ['oqdaryo', 'оқдарё'], courtId: 'samtfsud' },
  { keywords: ['qoshrabot', 'қошработ'], courtId: 'ishtixtfsud' },
  // Sirdaryo
  { keywords: ['boyovut', 'боёвут'], courtId: 'boyovtfsud' },
  { keywords: ['guliston', 'gulistan', 'гулистон'], courtId: 'gulistfsud' },
  { keywords: ['oqoltin', 'oqoltin', 'оқолтин'], courtId: 'okolttfsud' },
  { keywords: ['sirdaryo', 'сирдарё'], courtId: 'sirdtfsud' },
  { keywords: ['mirzaobod', 'мирзаобод'], courtId: 'gulistfsud' },
  { keywords: ['sayxunobod', 'сайхунобод'], courtId: 'boyovtfsud' },
  { keywords: ['sardoba', 'сардоба'], courtId: 'sirdtfsud' },
  // Surxondaryo
  { keywords: ['boysun', 'бойсун'], courtId: 'boystfsud' },
  { keywords: ['denov', 'денов'], courtId: 'denovtfsud' },
  { keywords: ["qumqo'rg'on", 'qumqurgon', 'қумқўрғон'], courtId: 'kumkgtfsud' },
  { keywords: ['sariosiyo', 'сариосиё'], courtId: 'sariostfsud' },
  { keywords: ['termiz sh', 'термиз ш', 'термиз шаҳар'], courtId: 'termtfsud' },
  { keywords: ['termiz tuman', 'термиз туман'], courtId: 'termtfsud' },
  { keywords: ['sherobod', 'шеробод'], courtId: 'sherobtfsud' },
  { keywords: ['angor', 'ангрен', 'ангор'], courtId: 'termtfsud' },
  { keywords: ['muzrabot', 'музработ'], courtId: 'sariostfsud' },
  { keywords: ['uzun', 'узун'], courtId: 'sariostfsud' },
  { keywords: ["jarqo'rg'on", 'jarqurgon', 'жарқўрғон'], courtId: 'kumkgtfsud' },
  // Toshkent viloyati
  { keywords: ['bekobod', 'бекобод'], courtId: 'bekobtfsud' },
  { keywords: ['zangiota', 'зангиота'], courtId: 'zangtfsud' },
  { keywords: ["quyichirchiq", 'қуйичирчиқ'], courtId: 'kuychtfsud' },
  { keywords: ["ohangaron", 'оҳангарон'], courtId: 'oxantfsud' },
  { keywords: ["o'rtachirchiq", 'ortachirchiq', 'ўртачирчиқ'], courtId: 'urtchtfsud' },
  { keywords: ['chirchiq', 'чирчиқ'], courtId: 'chichtfsud' },
  { keywords: ["yuqorichirchiq", 'юқоричирчиқ'], courtId: 'yukchtfsud' },
  { keywords: ["yangiyo'l", 'yangiyul', 'янгийўл'], courtId: 'yangiyultgsud' },
  { keywords: ['bo"ka', 'boka', 'бўка'], courtId: 'zangtfsud' },
  { keywords: ['qibloy', 'қиблай'], courtId: 'urtchtfsud' },
  { keywords: ['ohangaron sh', 'оҳангарон ш'], courtId: 'oxantfsud' },
  { keywords: ['olmaliq', 'олмалиқ'], courtId: 'oxantfsud' },
  { keywords: ['angren', 'ангрен'], courtId: 'oxantfsud' },
  // Toshkent shahar
  { keywords: ['mirzo ulug"bek', 'mirzo ulugbek', 'мирзо улуғбек', 'ulugbek', 'улуғбек'], courtId: 'mulugtfsud' },
  { keywords: ['mirishkor', 'миришкор', 'mirabad', 'миробод', 'мирабад'], courtId: 'mirtfsud' },
  { keywords: ['uchtepa', 'учтепа'], courtId: 'uchttfsud' },
  { keywords: ['shayxontohur', 'shaykhontohur', 'шайхонтоҳур'], courtId: 'shayxtfsud' },
  { keywords: ['yakkasaroy', 'яккасарой'], courtId: 'yakkatfsud' },
  { keywords: ['yunusobod', 'юнособод', 'yunusabad'], courtId: 'mulugtfsud' },
  { keywords: ['yashnobod', 'яшнобод'], courtId: 'mirtfsud' },
  { keywords: ['chilonzor', 'чилонзор'], courtId: 'uchttfsud' },
  { keywords: ['sergeli', 'сергели'], courtId: 'yakkatfsud' },
  { keywords: ['olmazor', 'олмазор'], courtId: 'shayxtfsud' },
  { keywords: ['bektemir', 'бектемир'], courtId: 'yakkatfsud' },
  { keywords: ['yangihayot', 'янгиҳаёт'], courtId: 'yakkatfsud' },
  // Farg'ona
  { keywords: ["qo'qon", 'qoqon', 'қўқон'], courtId: 'kokantfsud' },
  { keywords: ["marg'ilon", 'margilon', 'марғилон'], courtId: 'margiltfsud' },
  { keywords: ['rishton', 'риштон'], courtId: 'rishtontfsud' },
  { keywords: ["so'x", 'sox', 'сўх'], courtId: 'suxtfsud' },
  { keywords: ['o"zbekiston', 'uzbekiston', 'ўзбекистон'], courtId: 'uzbektfsud' },
  { keywords: ["farg'ona sh", 'fargona sh', 'фарғона ш', 'фарғона шаҳар'], courtId: 'fargtfsud' },
  { keywords: ["farg'ona tuman", 'fargona tuman', 'фарғона туман'], courtId: 'fargtfsud' },
  { keywords: ['quva', 'қува'], courtId: 'fargtfsud' },
  { keywords: ['quvasoy', 'қувасой'], courtId: 'fargtfsud' },
  { keywords: ['buvayda', 'бувайда'], courtId: 'rishtontfsud' },
  { keywords: ['oltiariq', 'олтиариқ'], courtId: 'rishtontfsud' },
  { keywords: ['furgat', 'фурғат'], courtId: 'fargtfsud' },
  // Xorazm
  { keywords: ["bog'ot", 'bogot', 'боғот'], courtId: 'bogottfsud' },
  { keywords: ['urganch sh', 'urganch shahar', 'урганч ш', 'урганч шаҳар'], courtId: 'urgatfsud' },
  { keywords: ['urganch tuman', 'урганч туман'], courtId: 'urgatfsud' },
  { keywords: ['shovot', 'шовот'], courtId: 'shovtfsud' },
  { keywords: ['xorazm', 'хоразм'], courtId: 'xorzvilfsud' },
  { keywords: ['xiva', 'хива'], courtId: 'urgatfsud' },
  { keywords: ['xazorasp', 'хазорасп'], courtId: 'urgatfsud' },
  { keywords: ["yangiariq", 'янгиариқ'], courtId: 'shovtfsud' },
  { keywords: ["qo'shko'pir", 'qoshkopir', 'қўшкўпир'], courtId: 'shovtfsud' },
  { keywords: ['tuproqqala', 'тупроққала'], courtId: 'urgatfsud' },
]

/**
 * Find courts for a given address string.
 * Tries to match the region from the address, then returns all courts in that region.
 * The user can then select the specific district court.
 */
export function findCourtsByAddress(address: string): CourtEntry[] {
  const addrLower = address.toLowerCase()

  for (const { latin, cyrillic } of REGION_MAP) {
    // Match either Latin or Cyrillic region name
    if (addrLower.includes(latin) || address.includes(cyrillic)) {
      return CIVIL_COURTS.filter(c => c.region.includes(cyrillic))
    }
  }

  // Fallback: try to match any region name directly
  return CIVIL_COURTS.filter(c => address.includes(c.region))
}

/**
 * Get all courts (for displaying the full list in UI).
 */
export function getAllCourts(): CourtEntry[] {
  return CIVIL_COURTS
}

/**
 * Get all unique regions.
 */
export function getAllRegions(): string[] {
  return [...new Set(CIVIL_COURTS.map(c => c.region))]
}

/**
 * Find the best matching court for a given address.
 * First tries the district→court mapping (precise), then falls back to
 * name matching, then to the region-level court.
 */
export function findBestCourt(address: string): CourtEntry | null {
  const addrLower = address.toLowerCase()

  // Step 1: Try the district→court mapping (most precise)
  for (const { keywords, courtId } of DISTRICT_COURT_MAP) {
    for (const kw of keywords) {
      if (addrLower.includes(kw.toLowerCase()) || address.includes(kw)) {
        const court = CIVIL_COURTS.find(c => c.id === courtId)
        if (court) {
          console.log(`[court-map] matched district "${kw}" → court ${courtId} (${court.name})`)
          return court
        }
      }
    }
  }

  // Step 2: Try name matching against court names
  const courts = findCourtsByAddress(address)
  if (courts.length === 0) return null

  const addrWords = address.split(/[\s,]+/).filter(w => w.length > 3)
  for (const court of courts) {
    const courtDistrict = court.name.replace(/\s+(туманлараро|туман|шаҳар|вилоят)\s+суди/, '').trim()
    for (const word of addrWords) {
      if (courtDistrict.toLowerCase().includes(word.toLowerCase()) ||
          word.toLowerCase().includes(courtDistrict.toLowerCase())) {
        return court
      }
    }
  }

  // Step 3: Fallback to region-level court
  const regionCourt = courts.find(c => c.name.includes('вилоят суди'))
  return regionCourt || courts[0]
}
