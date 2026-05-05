/**
 * Map normalized product `brand` strings → registrable domain for favicon chips
 * (Google s2 favicons). Curated for common fashion labels; unknown brands fall
 * through to listing-site favicon or default in `vendorLogo.ts`.
 */
const BRAND_DOMAIN_BY_KEY: Record<string, string> = {
  adidas: 'adidas.com',
  'adidas originals': 'adidas.com',
  nike: 'nike.com',
  jordan: 'nike.com',
  puma: 'puma.com',
  reebok: 'reebok.com',
  'new balance': 'newbalance.com',
  converse: 'converse.com',
  vans: 'vans.com',
  fila: 'fila.com',
  champion: 'champion.com',
  'under armour': 'underarmour.com',
  asics: 'asics.com',
  brooks: 'brooksrunning.com',
  skechers: 'skechers.com',
  crocs: 'crocs.com',
  birkenstock: 'birkenstock.com',
  'dr martens': 'drmartens.com',
  'dr. martens': 'drmartens.com',
  ugg: 'ugg.com',
  clarks: 'clarks.com',
  timberland: 'timberland.com',
  'the north face': 'thenorthface.com',
  columbia: 'columbia.com',
  patagonia: 'patagonia.com',
  arcteryx: 'arcteryx.com',
  salomon: 'salomon.com',
  merrell: 'merrell.com',
  levis: 'levis.com',
  "levi's": 'levis.com',
  lee: 'lee.com',
  wrangler: 'wrangler.com',
  diesel: 'diesel.com',
  guess: 'guess.com',
  'calvin klein': 'calvinklein.com',
  ck: 'calvinklein.com',
  'tommy hilfiger': 'tommy.com',
  'ralph lauren': 'ralphlauren.com',
  polo: 'ralphlauren.com',
  lacoste: 'lacoste.com',
  hugo: 'hugoboss.com',
  boss: 'hugoboss.com',
  'hugo boss': 'hugoboss.com',
  armani: 'armani.com',
  gucci: 'gucci.com',
  prada: 'prada.com',
  burberry: 'burberry.com',
  coach: 'coach.com',
  'michael kors': 'michaelkors.com',
  'tory burch': 'toryburch.com',
  'kate spade': 'katespade.com',
  'marc jacobs': 'marcjacobs.com',
  'kate spade new york': 'katespade.com',
  lululemon: 'lululemon.com',
  everlane: 'everlane.com',
  uniqlo: 'uniqlo.com',
  zara: 'zara.com',
  'massimo dutti': 'massimodutti.com',
  mango: 'mango.com',
  cos: 'cos.com',
  hm: 'hm.com',
  'h and m': 'hm.com',
  gap: 'gap.com',
  'old navy': 'oldnavy.gap.com',
  'banana republic': 'bananarepublic.gap.com',
  jcrew: 'jcrew.com',
  'j crew': 'jcrew.com',
  madewell: 'madewell.com',
  anthropologie: 'anthropologie.com',
  'free people': 'freepeople.com',
  'urban outfitters': 'urbanoutfitters.com',
  asos: 'asos.com',
  boohoo: 'boohoo.com',
  shein: 'shein.com',
  prettylittlething: 'prettylittlething.com',
  missguided: 'missguided.com',
  revolve: 'revolve.com',
  farfetch: 'farfetch.com',
  ssense: 'ssense.com',
  nordstrom: 'nordstrom.com',
  'neiman marcus': 'neimanmarcus.com',
  saks: 'saksfifthavenue.com',
  bloomingdales: 'bloomingdales.com',
  macys: 'macys.com',
  'barneys new york': 'barneys.com',
  selfridges: 'selfridges.com',
  mytheresa: 'mytheresa.com',
  'net a porter': 'net-a-porter.com',
  'matches fashion': 'matchesfashion.com',
  'stuart weitzman': 'stuartweitzman.com',
  jimmychoo: 'jimmychoo.com',
  'jimmy choo': 'jimmychoo.com',
  'christian louboutin': 'louboutin.com',
  louboutin: 'louboutin.com',
  balenciaga: 'balenciaga.com',
  versace: 'versace.com',
  fendi: 'fendi.com',
  valentino: 'valentino.com',
  'saint laurent': 'ysl.com',
  ysl: 'ysl.com',
  'alexander mcqueen': 'alexandermcqueen.com',
  'bottega veneta': 'bottegaveneta.com',
  loewe: 'loewe.com',
  celine: 'celine.com',
  dior: 'dior.com',
  chanel: 'chanel.com',
  hermes: 'hermes.com',
  'hermès': 'hermes.com',
  louisvuitton: 'louisvuitton.com',
  'louis vuitton': 'louisvuitton.com',
  moncler: 'moncler.com',
  'canada goose': 'canadagoose.com',
  stoneisland: 'stoneisland.com',
  'stone island': 'stoneisland.com',
  carhartt: 'carhartt.com',
  dickies: 'dickies.com',
  'theory': 'theory.com',
  'vince': 'vince.com',
  'allsaints': 'allsaints.com',
  'all saints': 'allsaints.com',
  'ted baker': 'tedbaker.com',
  tedbaker: 'tedbaker.com',
  'kith': 'kith.com',
  'supreme': 'supremenewyork.com',
  'off white': 'off---white.com',
  offwhite: 'off---white.com',
  palmangels: 'palmangels.com',
  'palm angels': 'palmangels.com',
  'ami paris': 'amiparis.com',
  ami: 'amiparis.com',
  'acne studios': 'acnestudios.com',
  acne: 'acnestudios.com',
  'isabel marant': 'isabelmarant.com',
  'ganni': 'ganni.com',
  staud: 'staud.com',
  'reformation': 'thereformation.com',
  'agolde': 'agolde.com',
  'mother denim': 'motherdenim.com',
  mother: 'motherdenim.com',
}

function normalizeBrandKey(brand: string): string {
  return brand
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[''`´]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns a domain suitable for `s2/favicons` when the catalog has a known brand name.
 */
export function domainForBrandName(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const key = normalizeBrandKey(trimmed)
  if (BRAND_DOMAIN_BY_KEY[key]) return BRAND_DOMAIN_BY_KEY[key]

  const parts = key.split(' ').filter(Boolean)
  for (let len = parts.length; len >= 1; len--) {
    const prefix = parts.slice(0, len).join(' ')
    if (BRAND_DOMAIN_BY_KEY[prefix]) return BRAND_DOMAIN_BY_KEY[prefix]
  }

  return null
}

export function faviconUrlForDomain(domain: string): string {
  const d = domain.trim().toLowerCase()
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`
}
