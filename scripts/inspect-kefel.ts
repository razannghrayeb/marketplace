import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.goto('https://kefelfashion.netlify.app', { waitUntil: 'networkidle' })

  // Click Men link to reveal men's products
  await page.evaluate(() => {
    const links = document.querySelectorAll('nav a')
    links.forEach((a: any) => { if (a.innerText.trim() === 'Men') a.click() })
  })
  await page.waitForTimeout(500)

  const allCards = await page.evaluate(() => {
    const cards: any[] = []
    document.querySelectorAll('[class*="card"]').forEach((el) => {
      const img = el.querySelector('img')
      const lines = (el as HTMLElement).innerText.trim().split('\n').map(s => s.trim()).filter(Boolean)

      // Try to find price elements
      const prices: string[] = []
      el.querySelectorAll('[class*="price"], [class*="Price"]').forEach((p: any) => {
        prices.push(p.innerText.trim())
      })

      cards.push({
        text_lines: lines,
        img_src: img?.src?.slice(0, 100) ?? null,
        img_alt: img?.alt ?? null,
        prices,
        html_snippet: el.innerHTML.slice(0, 600)
      })
    })
    return cards
  })

  console.log(JSON.stringify(allCards, null, 2))
  await browser.close()
}

main().catch(console.error)
