/** Printed surface adaptations only — original scene geometry and timing stay intact */
const ROOT = '/scenes/reference/assets/brand/'
const FONT = '"IBM Plex Sans Arabic"'
const INK = '#101011'
const atlasFiles = {
  spcAtlas: 'base-shards-petals-coins.webp',
  moneyShredsAtlas: 'base-leather-money-shreds.webp',
  certAtlas: 'base-board-certificates.webp',
}
const pending = new Map()

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load surface artwork ${url}`))
    image.src = url
  })
}

function canvas(width, height) {
  const result = document.createElement('canvas')
  result.width = width
  result.height = height
  return result
}

function label(ctx, text, x, y, width, size, color = INK, weight = 500) {
  ctx.save()
  ctx.direction = 'rtl'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  let fittedSize = size
  do {
    ctx.font = `${weight} ${fittedSize}px ${FONT}`
    if (ctx.measureText(text).width <= width || fittedSize <= 9) break
    fittedSize -= 1
  } while (fittedSize > 9)
  ctx.fillText(text, x + width / 2, y)
  ctx.restore()
}

function lines(ctx, copy, rect, size, color = INK, weight = 500) {
  const [x, y, width, height] = rect
  const step = height / copy.length
  copy.forEach((text, index) => label(ctx, text, x, y + step * (index + 0.5), width, size, color, weight))
}

function logo(ctx, image, rect) {
  const [x, y, width, height] = rect
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const w = image.naturalWidth * scale
  const h = image.naturalHeight * scale
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h)
}

/** Fill only authored print regions with nearby paper then preserve the original alpha */
function paper(ctx, rect, color = '#c6c6be') {
  ctx.save()
  ctx.fillStyle = color
  ctx.fillRect(...rect)
  ctx.restore()
}

const statisticRegions = [
  [0, 0, 856, 381, false, ['رؤية واضحة', 'وأثر يبقى']],
  [881, 0, 860, 518, false, ['كل فكرة', 'تستحق أن ترى النور']],
  [1765, 0, 735, 283, true, ['من الفكرة', 'إلى التجربة']],
  [0, 699, 1024, 363, false, ['نصنع حضورك', 'بتفاصيل تشبهك']],
  [1042, 737, 952, 502, false, ['هوية متكاملة', 'برؤية صيت']],
  [563, 1073, 975, 370, true, ['إبداع يتحرك', 'وتجربة تترك أثرها']],
]
const coinRegions = [[0, 1877], [171, 1877], [986, 1877], [1157, 1877], [1327, 1877], [1498, 1877], [1669, 1877], [1840, 1877]]

function brandShards(ctx, brandLogo) {
  for (const [x, y, width, height, rotated, copy] of statisticRegions) {
    const print = canvas(width, height)
    lines(print.getContext('2d'), copy, [18, 12, width - 36, height - 24], Math.min(height * 0.35, 132), '#ffffff', 600)
    ctx.clearRect(x, y, rotated ? height : width, rotated ? width : height)
    ctx.save()
    if (rotated) {
      ctx.translate(x + height, y)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(print, 0, 0)
    } else ctx.drawImage(print, x, y)
    ctx.restore()
  }
  for (const [x, y] of coinRegions) {
    // The outer highlight and the exact original coin silhouette are untouched
    ctx.save()
    ctx.beginPath()
    ctx.arc(x + 85.5, y + 85.5, 62, 0, Math.PI * 2)
    ctx.clip()
    paper(ctx, [x + 22, y + 22, 127, 127], '#ffffff')
    logo(ctx, brandLogo, [x + 23, y + 57, 125, 55])
    ctx.restore()
  }
}

const quotePanels = [
  { rect: [0, 0, 492, 912], portrait: [33, 614, 155, 157], copy: ['رؤية تبدأ بفكرة', 'وتنمو بالتفاصيل', 'حتى تصبح', 'تجربة تستحق', 'أن تعاش'] },
  { rect: [492, 0, 492, 912], portrait: [523, 613, 156, 157], copy: ['نمنح الفكرة', 'لغة بصرية', 'وصوتا واضحا', 'وحضورا', 'يصنع الفرق'] },
  { rect: [982, 0, 492, 912], portrait: [1013, 600, 155, 159], copy: ['التفاصيل الصغيرة', 'تصنع المشهد', 'والرؤية الواضحة', 'تمنحه', 'معناه'] },
  { rect: [0, 911, 491, 1137], portrait: [24, 1565, 155, 160], copy: ['إبداع من الفكرة', 'إلى آخر تفصيلة', 'بهوية تليق', 'بكل طموح'] },
  { rect: [492, 913, 490, 1135], portrait: [521, 1523, 158, 157], copy: ['نحول الرؤية', 'إلى هوية', 'ونحول الهوية', 'إلى تجربة'] },
  { rect: [983, 912, 491, 911], portrait: [1012, 1445, 157, 159], copy: ['من الفكرة', 'إلى التنفيذ', 'كل خطوة', 'تحمل رؤيتك'] },
]

function brandQuotes(ctx, source, brandLogo) {
  for (const { rect, portrait, copy } of quotePanels) {
    const [x, y, width, height] = rect
    paper(ctx, rect)
    // These are the original printed portraits — no illustration is regenerated
    ctx.drawImage(source, ...portrait, ...portrait)
    const headlineTop = y + height * 0.16
    lines(ctx, copy, [x + 23, headlineTop, width - 46, portrait[1] - headlineTop - 32], 49, '#192d26', 600)
    logo(ctx, brandLogo, [portrait[0] + portrait[2] + 18, portrait[1] + 45, width - portrait[2] - 74, 70])
    const detail = ['صيت تحول الرؤية إلى تجربة', 'تصميم وهوية وحضور بصري متكامل', 'من الفكرة إلى التنفيذ بكل التفاصيل']
    lines(ctx, detail, [x + 16, y + 15, width - 32, Math.min(110, height * 0.12)], 17, '#37463c', 400)
    const below = portrait[1] + portrait[3] + 24
    if (y + height - below > 40) lines(ctx, detail, [x + 16, below, width - 32, Math.min(130, y + height - below - 12)], 17, '#37463c', 400)
  }
}

function brandBanknote(ctx, source, brandLogo) {
  // The banknote is packed clockwise in the original atlas
  const rect = [1474, 0, 574, 1284]
  const print = canvas(1284, 574)
  const bank = print.getContext('2d')
  bank.translate(0, 574)
  bank.rotate(-Math.PI / 2)
  bank.drawImage(source, ...rect, 0, 0, 574, 1284)
  bank.setTransform(1, 0, 0, 1, 0, 0)
  // Preserve all borders engraving numerals folds and the engraved hand portrait
  const patches = [
    [60, 94, 295, 31], [60, 130, 295, 84],
    [102, 366, 199, 35], [124, 408, 158, 28], [141, 440, 131, 19],
    [53, 438, 33, 25], [740, 451, 44, 25],
    [805, 90, 322, 105], [818, 357, 299, 48],
    [793, 422, 209, 36], [826, 459, 145, 20],
  ]
  // Copy nearby unprinted paper grain into print regions only
  // The source is snapshotted so the sample cannot include a previous patch
  const unprinted = canvas(62, 62)
  unprinted.getContext('2d').drawImage(print, 1115, 275, 62, 62, 0, 0, 62, 62)
  for (const patch of patches) bank.drawImage(unprinted, ...patch)
  label(bank, 'صيت', 60, 109, 295, 25, '#263f30', 600)
  label(bank, 'رؤية تصنع الأثر', 60, 171, 295, 28, '#263f30', 500)
  // Keep the circular seal perimeter while replacing its source wordmark
  bank.save()
  bank.beginPath()
  bank.arc(204, 283, 65, 0, Math.PI * 2)
  bank.clip()
  bank.drawImage(unprinted, 139, 218, 130, 130)
  logo(bank, brandLogo, [145, 258, 118, 51])
  bank.restore()
  label(bank, 'من الفكرة إلى التنفيذ', 102, 384, 199, 16, '#263f30', 500)
  label(bank, 'صيت', 124, 422, 158, 21, '#263f30', 500)
  label(bank, 'رؤية تتجدد', 141, 450, 131, 14, '#263f30', 500)
  lines(bank, ['رؤية صيت', 'إبداع يصنع الفرق'], [805, 95, 322, 96], 36, '#263f30', 600)
  label(bank, 'هوية تستحق الحضور', 818, 383, 299, 28, '#263f30')
  label(bank, 'صيت', 793, 441, 209, 26, '#263f30')
  label(bank, 'أثر يبقى', 826, 470, 145, 14, '#263f30')
  paper(bank, [678, 497, 550, 25], '#79806a')
  label(bank, 'صيت تحول الرؤية إلى تجربة', 678, 510, 550, 24, '#1f3327', 600)
  ctx.save()
  ctx.translate(rect[0] + rect[2], rect[1])
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(print, 0, 0)
  ctx.restore()
}

const certificates = [
  { rect: [0, 0, 658, 512], preserves: [[273, 358, 120, 119]] },
  { rect: [658, 0, 658, 512], preserves: [[931, 380, 116, 114]] },
  { rect: [1316, 0, 658, 512], preserves: [[1533, 419, 70, 77], [1600, 395, 111, 105]] },
  { rect: [0, 512, 658, 512], preserves: [[93, 886, 89, 110]] },
  { rect: [0, 1024, 658, 512], preserves: [[276, 1050, 90, 91], [276, 1441, 98, 91]] },
  { rect: [0, 1536, 658, 512], preserves: [[270, 1920, 119, 124]] },
  { rect: [658, 1536, 658, 512], preserves: [[776, 1566, 61, 65]] },
  { rect: [1316, 1536, 658, 512], preserves: [[1467, 1589, 68, 74], [1598, 1955, 114, 89]] },
]

/** Remove dark print while retaining the paper texture and faint embossed artwork */
function removeCertificatePrint(ctx, rect, preserves) {
  const [x, y, width, height] = rect
  const pixels = ctx.getImageData(x, y, width, height)
  const original = new Uint8ClampedArray(pixels.data)
  const tile = 32
  const backgroundPixels = new Uint8ClampedArray(width * height * 3)
  const ink = new Uint8Array(width * height)
  for (let by = 0; by < height; by += tile) for (let bx = 0; bx < width; bx += tile) {
    const samples = []
    for (let py = by; py < Math.min(by + tile, height); py += 2) for (let px = bx; px < Math.min(bx + tile, width); px += 2) {
      const i = (py * width + px) * 4
      samples.push([original[i], original[i + 1], original[i + 2]])
    }
    samples.sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2])
    const background = samples[Math.floor(samples.length * 0.6)]
    const threshold = (background[0] + background[1] + background[2]) / 3 - 18
    for (let py = by; py < Math.min(by + tile, height); py++) for (let px = bx; px < Math.min(bx + tile, width); px++) {
      const i = (py * width + px) * 4
      const b = (py * width + px) * 3
      backgroundPixels[b] = background[0]
      backgroundPixels[b + 1] = background[1]
      backgroundPixels[b + 2] = background[2]
      if ((original[i] + original[i + 1] + original[i + 2]) / 3 < threshold || original[i + 1] < background[1] - 18) {
        // Include antialiasing and compression fringes around the original ink
        for (let yy = Math.max(0, py - 3); yy <= Math.min(height - 1, py + 3); yy++) {
          ink.fill(1, yy * width + Math.max(0, px - 3), yy * width + Math.min(width, px + 4))
        }
      }
    }
  }
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    if (preserves.some(([sx, sy, sw, sh]) => px + x >= sx && px + x < sx + sw && py + y >= sy && py + y < sy + sh)) continue
    const n = py * width + px
    if (!ink[n]) continue
    const i = n * 4
    const b = n * 3
    pixels.data[i] = backgroundPixels[b]
    pixels.data[i + 1] = backgroundPixels[b + 1]
    pixels.data[i + 2] = backgroundPixels[b + 2]
  }
  ctx.putImageData(pixels, x, y)
}

function brandCertificates(ctx, source, brandLogo) {
  for (const { rect, preserves } of certificates) {
    const [x, y, width, height] = rect
    removeCertificatePrint(ctx, rect, preserves)
    logo(ctx, brandLogo, [x + 175, y + 30, 308, 82])
    lines(ctx, ['شهادة إبداع', 'من الفكرة إلى التنفيذ', 'رؤية صيت'], [x + 65, y + 140, width - 130, 154], 31, '#13291f', 500)
    lines(ctx, ['نصنع هوية تعبر عنك', 'وتجربة متكاملة تترك أثرها'], [x + 70, y + 305, width - 140, 58], 16, '#213326', 400)
    label(ctx, 'صيت', x + 42, y + height - 45, 166, 19)
    label(ctx, 'رؤية تصنع الأثر', x + width - 230, y + height - 45, 190, 18)
    for (const illustration of preserves) ctx.drawImage(source, ...illustration, ...illustration)
  }
}

/** Upright canvas for THREE.CanvasTexture with flipY true */
export function createBrandSurfaceAtlasCanvas(key) {
  if (!atlasFiles[key]) return Promise.reject(new Error(`Unknown surface atlas ${key}`))
  if (pending.has(key)) return pending.get(key)
  const task = Promise.all([
    loadImage(ROOT + atlasFiles[key]),
    loadImage('/brand/seet-logo-dark.svg'),
    document.fonts.load(`600 48px ${FONT}`),
    document.fonts.load(`500 28px ${FONT}`),
    document.fonts.load(`400 18px ${FONT}`),
  ]).then(([source, brandLogo]) => {
    const result = canvas(source.naturalWidth, source.naturalHeight)
    const ctx = result.getContext('2d', { willReadFrequently: key === 'certAtlas' })
    ctx.drawImage(source, 0, 0)
    if (key === 'spcAtlas') brandShards(ctx, brandLogo)
    if (key === 'moneyShredsAtlas') {
      brandQuotes(ctx, source, brandLogo)
      brandBanknote(ctx, source, brandLogo)
    }
    if (key === 'certAtlas') brandCertificates(ctx, source, brandLogo)
    return result
  }).catch(error => {
    pending.delete(key)
    throw error
  })
  pending.set(key, task)
  return task
}
