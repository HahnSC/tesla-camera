import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri/overlay')
fs.mkdirSync(dir, { recursive: true })

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c
}

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, sum])
}

const png = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const canvas = (w, h) => Buffer.alloc(w * h * 4)

const put = (buf, w, x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= w || y >= buf.length / (w * 4)) return
  const i = (y * w + x) * 4
  buf[i] = r
  buf[i + 1] = g
  buf[i + 2] = b
  buf[i + 3] = a
}

const insidePoly = (poly, x, y) => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const save = (name, buf, w, h) => fs.writeFileSync(path.join(dir, name), png(w, h, buf))

const paintWheel = (color) => {
  const w = 88
  const buf = canvas(w, w)
  const [r, g, b] = color
  const s = w / 24
  const cx = 12 * s
  const cy = 12 * s
  const radius = 8.4 * s
  const stroke = 1.8 * s
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const dist = Math.hypot(dx, dy)
      const ring = Math.abs(dist - radius) <= stroke / 2
      const dot = dist <= 1.7 * s
      const spoke = Math.abs(dy) <= stroke / 2 && dist < radius && Math.abs(dx) >= 4.1 * s
        || Math.abs(dx) <= stroke / 2 && dy >= 3.4 * s && dy <= 7.5 * s
      if (ring || dot || spoke) put(buf, w, x, y, r, g, b, 255)
    }
  }
  return buf
}

const paintArrow = (left, color) => {
  const w = 88
  const h = 72
  const buf = canvas(w, h)
  const [r, g, b] = color
  const poly = [[13, 1], [3, 9], [13, 17], [13, 12], [20, 12], [20, 6], [13, 6]].map(([x, y]) => [
    (left ? x : 22 - x) * 4,
    y * 4,
  ])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (insidePoly(poly, x + 0.5, y + 0.5)) put(buf, w, x, y, r, g, b, 255)
    }
  }
  return buf
}

const paintCircle = (fillRatio, fill, base) => {
  const w = 64
  const buf = canvas(w, w)
  const top = w * (1 - fillRatio)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x + 0.5 - w / 2, y + 0.5 - w / 2)
      if (dist > w / 2) continue
      const color = y + 0.5 >= top ? fill : base
      put(buf, w, x, y, color[0], color[1], color[2], 255)
    }
  }
  return buf
}

const paintCard = () => {
  const w = 688
  const h = 248
  const radius = 64
  const buf = canvas(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x + 0.5 - w / 2) - (w / 2 - radius)
      const dy = Math.abs(y + 0.5 - h / 2) - (h / 2 - radius)
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
      if (outside <= radius) put(buf, w, x, y, 255, 255, 255, 51)
    }
  }
  return buf
}

save('wheel.png', paintWheel([138, 138, 138]), 88, 88)
save('wheel-ap.png', paintWheel([47, 124, 246]), 88, 88)
save('blink-l.png', paintArrow(true, [26, 74, 40]), 88, 72)
save('blink-l-on.png', paintArrow(true, [125, 255, 106]), 88, 72)
save('blink-r.png', paintArrow(false, [26, 74, 40]), 88, 72)
save('blink-r-on.png', paintArrow(false, [125, 255, 106]), 88, 72)
save('brake-off.png', paintCircle(0, [213, 213, 213], [213, 213, 213]), 64, 64)
save('brake-on.png', paintCircle(1, [255, 59, 48], [255, 59, 48]), 64, 64)
save('card.png', paintCard(), 688, 248)
for (let step = 0; step <= 20; step++) {
  const name = `accel-${String(step).padStart(2, '0')}.png`
  save(name, paintCircle(step / 20, [92, 92, 92], [213, 213, 213]), 64, 64)
}
