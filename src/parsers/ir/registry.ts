/**
 * Iranian banks: card BIN prefixes (IIN), IBAN bank codes, SMS sender identifiers
 * and the words their messages are recognised by. This is the built-in seed; the
 * `banks` table is editable from the admin panel (senders change from time to time).
 *
 * Sender identifiers marked `verified` were observed on real devices; the others are
 * the banks' published SMS short codes. Unknown senders are never trusted
 * automatically: they land in the review queue until an admin/merchant trusts them.
 */
export interface BankInfo {
  id: string;
  nameFa: string;
  nameEn: string;
  shortFa: string;
  color: string;
  bins: string[];
  ibanCode?: string;
  senders: string[];
  keywords: string[];
  /** Neo-banks settle through a parent bank (Blu → Saman). Same-bank routing uses the parent. */
  parent?: string;
  /** Merged into another bank (cards still work, SMS come from the new bank). */
  mergedInto?: string;
  sort: number;
}

export const BANKS: BankInfo[] = [
  {
    id: 'mellat',
    nameFa: 'بانک ملت',
    nameEn: 'Bank Mellat',
    shortFa: 'ملت',
    color: '#D3202F',
    bins: ['610433', '991975'],
    ibanCode: '012',
    senders: ['Bank Mellat', 'BankMellat', 'Mellat Bank'],
    keywords: ['بانک ملت', 'ملت'],
    sort: 1,
  },
  {
    id: 'melli',
    nameFa: 'بانک ملی ایران',
    nameEn: 'Bank Melli Iran',
    shortFa: 'ملی',
    color: '#0E5AA7',
    bins: ['603799'],
    ibanCode: '017',
    senders: ['700717', 'Bank Melli', 'BankMelli', 'BMI'],
    keywords: ['بانک ملی ایران', 'بانک ملی'],
    sort: 2,
  },
  {
    id: 'saderat',
    nameFa: 'بانک صادرات ایران',
    nameEn: 'Bank Saderat Iran',
    shortFa: 'صادرات',
    color: '#1C3F94',
    bins: ['603769'],
    ibanCode: '019',
    senders: ['200060', 'Bank Saderat', 'BankSaderat', 'BSI'],
    keywords: ['بانک صادرات', 'صادرات'],
    sort: 3,
  },
  {
    id: 'tejarat',
    nameFa: 'بانک تجارت',
    nameEn: 'Tejarat Bank',
    shortFa: 'تجارت',
    color: '#1E4C9A',
    bins: ['627353', '585983'],
    ibanCode: '018',
    senders: ['TejaratBank', 'Tejarat Bank'],
    keywords: ['بانک تجارت', 'تجارت'],
    sort: 4,
  },
  {
    id: 'sepah',
    nameFa: 'بانک سپه',
    nameEn: 'Bank Sepah',
    shortFa: 'سپه',
    color: '#0B3D91',
    // Includes the BINs of the banks merged into Sepah (Ansar, Ghavamin, Hekmat, Kosar, Mehr Eghtesad).
    bins: ['589210', '627381', '639599', '636949', '505801', '639370'],
    ibanCode: '015',
    senders: ['200020', '200021', '200022', 'BankSepah', 'Bank Sepah'],
    keywords: ['بانک سپه', 'سپه'],
    sort: 5,
  },
  {
    id: 'saman',
    nameFa: 'بانک سامان',
    nameEn: 'Saman Bank',
    shortFa: 'سامان',
    color: '#0097D6',
    bins: ['621986'],
    ibanCode: '056',
    senders: ['20000', 'SamanBank', 'Saman Bank'],
    keywords: ['بانک سامان', 'سامان'],
    sort: 6,
  },
  {
    id: 'blu',
    nameFa: 'بلوبانک',
    nameEn: 'Blu Bank',
    shortFa: 'بلو',
    color: '#1F6BFF',
    bins: [],
    senders: ['+989999987641'],
    keywords: ['بلو'],
    parent: 'saman',
    sort: 7,
  },
  {
    id: 'pasargad',
    nameFa: 'بانک پاسارگاد',
    nameEn: 'Bank Pasargad',
    shortFa: 'پاسارگاد',
    color: '#C99A2E',
    bins: ['502229', '639347'],
    ibanCode: '057',
    senders: ['B.Pasargad', 'BankPasargad', 'Pasargad'],
    keywords: ['بانک پاسارگاد', 'پاسارگاد'],
    sort: 8,
  },
  {
    id: 'parsian',
    nameFa: 'بانک پارسیان',
    nameEn: 'Parsian Bank',
    shortFa: 'پارسیان',
    color: '#8C1D40',
    bins: ['622106', '639194', '627884'],
    ibanCode: '054',
    senders: ['PARSIANBANK', 'Parsian Bank'],
    keywords: ['بانک پارسیان', 'پارسیان'],
    sort: 9,
  },
  {
    id: 'eghtesad-novin',
    nameFa: 'بانک اقتصاد نوین',
    nameEn: 'EN Bank',
    shortFa: 'اقتصاد نوین',
    color: '#5B2A86',
    bins: ['627412'],
    ibanCode: '055',
    senders: ['EN Bank', 'ENBank'],
    keywords: ['اقتصاد نوین', 'اقتصادنوین'],
    sort: 10,
  },
  {
    id: 'ayandeh',
    nameFa: 'بانک آینده',
    nameEn: 'Ayandeh Bank',
    shortFa: 'آینده',
    color: '#7B4A2D',
    bins: ['636214'],
    ibanCode: '062',
    senders: ['AyandehBank', 'Ayandeh Bank'],
    keywords: ['بانک آینده', 'آینده'],
    sort: 11,
  },
  {
    id: 'keshavarzi',
    nameFa: 'بانک کشاورزی',
    nameEn: 'Bank Keshavarzi',
    shortFa: 'کشاورزی',
    color: '#1C7C3A',
    bins: ['603770', '639217'],
    ibanCode: '016',
    senders: ['2000911', 'Keshavarzi Bank', 'BKI'],
    keywords: ['بانک کشاورزی', 'کشاورزی'],
    sort: 12,
  },
  {
    id: 'maskan',
    nameFa: 'بانک مسکن',
    nameEn: 'Bank Maskan',
    shortFa: 'مسکن',
    color: '#E5781E',
    bins: ['628023'],
    ibanCode: '014',
    senders: ['300014', 'Bank Maskan'],
    keywords: ['بانک مسکن', 'مسکن'],
    sort: 13,
  },
  {
    id: 'refah',
    nameFa: 'بانک رفاه کارگران',
    nameEn: 'Refah Bank',
    shortFa: 'رفاه',
    color: '#0D6E9C',
    bins: ['589463'],
    ibanCode: '013',
    senders: ['300066', '300044', 'Refah Bank'],
    keywords: ['بانک رفاه', 'رفاه'],
    sort: 14,
  },
  {
    id: 'post',
    nameFa: 'پست بانک ایران',
    nameEn: 'Post Bank of Iran',
    shortFa: 'پست بانک',
    color: '#0A8A43',
    bins: ['627760'],
    ibanCode: '021',
    senders: ['PostBank', 'Post Bank'],
    keywords: ['پست بانک', 'پستبانک'],
    sort: 15,
  },
  {
    id: 'shahr',
    nameFa: 'بانک شهر',
    nameEn: 'Shahr Bank',
    shortFa: 'شهر',
    color: '#C8102E',
    bins: ['502806', '504706'],
    ibanCode: '061',
    senders: ['Bank Shahr', 'Shahr Bank'],
    keywords: ['بانک شهر'],
    sort: 16,
  },
  {
    id: 'resalat',
    nameFa: 'بانک قرض‌الحسنه رسالت',
    nameEn: 'Resalat Bank',
    shortFa: 'رسالت',
    color: '#00A19A',
    bins: ['504172'],
    ibanCode: '070',
    senders: ['ResalatBank', 'Resalat Bank'],
    keywords: ['رسالت'],
    sort: 17,
  },
  {
    id: 'mehr-iran',
    nameFa: 'بانک قرض‌الحسنه مهر ایران',
    nameEn: 'Mehr Iran Bank',
    shortFa: 'مهر ایران',
    color: '#2BA24C',
    bins: ['606373'],
    ibanCode: '060',
    senders: ['B.QMEHRIRAN', 'QMEHRIRAN'],
    keywords: ['مهر ایران', 'قرض الحسنه مهر'],
    sort: 18,
  },
  {
    id: 'khavarmianeh',
    nameFa: 'بانک خاورمیانه',
    nameEn: 'Middle East Bank',
    shortFa: 'خاورمیانه',
    color: '#0B5563',
    bins: ['585947', '505809'],
    ibanCode: '078',
    senders: ['KH M BANK', 'KHMBANK'],
    keywords: ['بانک خاورمیانه', 'خاورمیانه'],
    sort: 19,
  },
  {
    id: 'tosee-taavon',
    nameFa: 'بانک توسعه تعاون',
    nameEn: 'Tose\'e Ta\'avon Bank',
    shortFa: 'توسعه تعاون',
    color: '#00978F',
    bins: ['502908'],
    ibanCode: '022',
    senders: ['TTBank'],
    keywords: ['توسعه تعاون'],
    sort: 20,
  },
  {
    id: 'tosee-saderat',
    nameFa: 'بانک توسعه صادرات',
    nameEn: 'Export Development Bank',
    shortFa: 'توسعه صادرات',
    color: '#1A6FB5',
    bins: ['627648', '207177'],
    ibanCode: '020',
    senders: ['EDBI'],
    keywords: ['توسعه صادرات'],
    sort: 21,
  },
  {
    id: 'sanat-madan',
    nameFa: 'بانک صنعت و معدن',
    nameEn: 'Bank of Industry and Mine',
    shortFa: 'صنعت و معدن',
    color: '#123E7C',
    bins: ['627961'],
    ibanCode: '011',
    senders: ['BIM'],
    keywords: ['صنعت و معدن', 'صنعت ومعدن'],
    sort: 22,
  },
  {
    id: 'karafarin',
    nameFa: 'بانک کارآفرین',
    nameEn: 'Karafarin Bank',
    shortFa: 'کارآفرین',
    color: '#109A4A',
    bins: ['627488', '502910'],
    ibanCode: '053',
    senders: ['KarafarinBank'],
    keywords: ['کارآفرین', 'کارافرین'],
    sort: 23,
  },
  {
    id: 'sina',
    nameFa: 'بانک سینا',
    nameEn: 'Sina Bank',
    shortFa: 'سینا',
    color: '#0072BC',
    bins: ['639346'],
    ibanCode: '059',
    senders: ['SinaBank'],
    keywords: ['بانک سینا', 'سینا'],
    sort: 24,
  },
  {
    id: 'sarmayeh',
    nameFa: 'بانک سرمایه',
    nameEn: 'Sarmayeh Bank',
    shortFa: 'سرمایه',
    color: '#5F6368',
    bins: ['639607'],
    ibanCode: '058',
    senders: ['SarmayehBank'],
    keywords: ['بانک سرمایه'],
    sort: 25,
  },
  {
    id: 'dey',
    nameFa: 'بانک دی',
    nameEn: 'Day Bank',
    shortFa: 'دی',
    color: '#0098A6',
    bins: ['502938'],
    ibanCode: '066',
    senders: ['DayBank', 'Bank Dey'],
    keywords: ['بانک دی'],
    sort: 26,
  },
  {
    id: 'iran-zamin',
    nameFa: 'بانک ایران زمین',
    nameEn: 'Iran Zamin Bank',
    shortFa: 'ایران زمین',
    color: '#6A2C8E',
    bins: ['505785'],
    ibanCode: '069',
    senders: ['IZBank'],
    keywords: ['ایران زمین', 'ایرانزمین'],
    sort: 27,
  },
  {
    id: 'gardeshgari',
    nameFa: 'بانک گردشگری',
    nameEn: 'Tourism Bank',
    shortFa: 'گردشگری',
    color: '#D7262E',
    bins: ['505416'],
    ibanCode: '064',
    senders: ['TourismBank'],
    keywords: ['گردشگری'],
    sort: 28,
  },
  {
    id: 'melal',
    nameFa: 'موسسه اعتباری ملل',
    nameEn: 'Melal Credit Institution',
    shortFa: 'ملل',
    color: '#1B75BB',
    bins: ['606256'],
    ibanCode: '075',
    senders: [],
    keywords: ['ملل'],
    sort: 29,
  },
  {
    id: 'noor',
    nameFa: 'موسسه اعتباری نور',
    nameEn: 'Noor Credit Institution',
    shortFa: 'نور',
    color: '#E8891C',
    bins: ['507677'],
    ibanCode: '080',
    senders: [],
    keywords: ['اعتباری نور'],
    sort: 30,
  },
];

export const BANK_BY_ID = new Map(BANKS.map((b) => [b.id, b]));

/** IBAN codes of banks that were merged into Sepah. */
const MERGED_IBAN: Record<string, string> = {
  '063': 'sepah', // Ansar
  '052': 'sepah', // Ghavamin
  '065': 'sepah', // Hekmat Iranian
  '073': 'sepah', // Kosar
  '090': 'sepah', // Mehr Eghtesad
};

export function bankByBin(card: string, banks: Pick<BankInfo, 'id' | 'bins'>[] = BANKS): string | null {
  const d = card.replace(/\D/g, '');
  if (d.length < 6) return null;
  const prefix = d.slice(0, 6);
  for (const b of banks) if (b.bins.includes(prefix)) return b.id;
  return null;
}

export function bankByIban(iban: string): string | null {
  const code = iban.slice(4, 7);
  const hit = BANKS.find((b) => b.ibanCode === code);
  return hit?.id ?? MERGED_IBAN[code] ?? null;
}

/** Bank used for same-bank routing (Blu cards are Saman cards). */
export function settlementBank(bankId: string | null | undefined): string | null {
  if (!bankId) return null;
  return BANK_BY_ID.get(bankId)?.parent ?? bankId;
}
