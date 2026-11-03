export const CATALOG_DATE = '09/2026';
export const CATALOG_FILE = 'Sánez catálogo octubre.pdf';

const source = (offers) => ({
  date: CATALOG_DATE,
  file: CATALOG_FILE,
  offers: offers.map(([label, priceCents, unitPriceCents = null]) => ({
    label,
    priceCents,
    unitPriceCents,
  })),
});

const polipapelOffers = [
  ['X200 U', 4129900],
  ['X500 U', 9843000],
  ['X1000 U', 18429900],
  ['X1200 U', 21329900],
  ['X2000 U', 32124000],
];

const product = (id, name, measure, reference) => ({
  id,
  name,
  measure,
  unitsPerPack: 1,
  minimum: 0,
  quantity: 0,
  costCents: null,
  saleCents: null,
  packSaleCents: null,
  archived: false,
  reference,
});

export const BASE_CATALOG = [
  product('catalog-polipapel-118', 'Vaso de polipapel · 118 cc / 4 oz', '', source(polipapelOffers)),
  product('catalog-polipapel-240', 'Vaso de polipapel · 240 cc / 8 oz', '', source(polipapelOffers)),
  product('catalog-polipapel-330', 'Vaso de polipapel · 330 cc / 12 oz', '', source([
    ['X100 U', 2399000],
    ['X200 U', 4387000],
    ['X500 U', 11275000],
    ['X1200 U', 23929900],
  ])),
  product('catalog-frappe-500', 'Vaso frappé · 500 cc', '', source([
    ['X100 U', 3800000],
    ['X200 U', 7300000],
    ['X500 U', 17500000],
    ['X1.000 U', 33500000],
  ])),
  product('catalog-frappe-400', 'Vaso frappé · 400 cc', '', source([
    ['X100 U', 3500000],
    ['X200 U', 6800000],
    ['X500 U', 16250000],
    ['X1.000 U', 31500000],
  ])),
  product('catalog-caja-30x22x9', 'Caja autoarmable', '30 × 22 × 9', source([
    ['X25 U', 2500000],
    ['X50 U', 5000000],
    ['X+100 U', null, 88000],
    ['X1.000 U', null, 60000],
  ])),
  product('catalog-ensaladera-50', 'Ensaladera · 50 oz', '', source([
    ['X25 U', 2000000],
    ['X50 U', 4000000],
    ['X100 U', 7700000],
    ['X200 U', 15000000],
    ['X400 U', 28000000],
  ])),
  product('catalog-portavasos', 'Portavasos', '', source([
    ['50 U', 700000],
    ['100 U', 1350000],
    ['200 U', 2800000],
    ['400 U', 4800000],
    ['800 U', 9200000],
  ])),
  product('catalog-autoarmable-valija', 'Autoarmable valija', '', source([
    ['X50 U', 1420000],
    ['X100 U', 2650000],
    ['X200 U', 5090000],
    ['X400 U', 9400000],
  ])),
];

export const PENDING_MEASURES = [
  {
    measure: '30 × 9 × 22',
    note: 'Podría ser la caja 30 × 22 × 9 del catálogo. Confirmar antes de unificar; no se creó otra ficha.',
  },
  {
    measure: '25 × 8 × 20',
    note: 'Medida informada sin producto claramente identificado. Pendiente de confirmar.',
  },
  {
    measure: '12 × 6,5 × 12',
    note: 'Medida informada sin producto claramente identificado. Pendiente de confirmar.',
  },
];
