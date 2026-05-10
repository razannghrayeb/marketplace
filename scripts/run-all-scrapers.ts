import 'dotenv/config'
import { runMoustache } from '../src/lib/scrape/runMoustache'
import { runMikesport } from '../src/lib/scrape/runMikesport'
import { runMyholdal } from '../src/lib/scrape/runMyholdal'
import { runEshopgsCrawl } from '../src/lib/scrape/runEshopgs'
import { runHashtagCrawl } from '../src/lib/scrape/runHashtag'
import { runFashionstands } from '../src/lib/scrape/runFashionstands'
import { runKefel } from '../src/lib/scrape/runKefel'

const SCRAPERS: Record<string, () => Promise<unknown>> = {
  moustache: runMoustache,
  mikesport: runMikesport,
  myholdal: runMyholdal,
  hashtag: runHashtagCrawl,
  eshopgs: runEshopgsCrawl,
  fashionstands: runFashionstands,
  kefel: runKefel,
}

async function main() {
  const target = process.argv[2]

  if (!target || target === 'all') {
    for (const [name, fn] of Object.entries(SCRAPERS)) {
      console.log(`\n${'='.repeat(50)}`)
      console.log(`Running: ${name}`)
      console.log('='.repeat(50))
      await fn().catch((e: Error) => console.error(`${name} failed:`, e.message))
    }
  } else {
    const fn = SCRAPERS[target]
    if (!fn) {
      console.error(`Unknown scraper: ${target}. Available: ${Object.keys(SCRAPERS).join(', ')}`)
      process.exit(1)
    }
    await fn().catch((e: Error) => console.error(`${target} failed:`, e.message))
  }
}

main()
