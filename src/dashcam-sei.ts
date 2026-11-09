export interface DashcamSample {
  time: number
  gear: 'P' | 'D' | 'R' | 'N'
  speedKmh: number
  brake: boolean
  accelerator: number
  autopilot: boolean
  steeringDeg: number
  blinkerLeft: boolean
  blinkerRight: boolean
}

const GEAR = ['P', 'D', 'R', 'N'] as const
const cache = new Map<string, Promise<DashcamSample[]>>()

export async function loadDashcamSeiFile(filePath: string): Promise<DashcamSample[]> {
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(filePath)
  return parseDashcamSei(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

export function loadDashcamSei(src: string): Promise<DashcamSample[]> {
  const hit = cache.get(src)
  if (hit) return hit
  const pending = fetch(src)
    .then(response => {
      if (!response.ok) throw new Error(String(response.status))
      return response.arrayBuffer()
    })
    .then(parseDashcamSei)
    .catch(() => [] as DashcamSample[])
  cache.set(src, pending)
  if (cache.size > 12) {
    const oldest = cache.keys().next().value
    if (oldest && oldest !== src) cache.delete(oldest)
  }
  return pending
}

export function parseDashcamSei(buffer: ArrayBuffer): DashcamSample[] {
  try {
    return readSamples(buffer)
  } catch {
    return []
  }
}

export function sampleAt(samples: DashcamSample[], timeSec: number): DashcamSample | null {
  if (samples.length === 0 || timeSec < samples[0].time) return null
  let lo = 0
  let hi = samples.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].time <= timeSec) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return samples[ans]
}

interface Box {
  type: string
  start: number
  end: number
}

function readSamples(buffer: ArrayBuffer): DashcamSample[] {
  const view = new DataView(buffer)
  const boxes = listBoxes(view, 0, view.byteLength)
  const mdat = boxes.find(box => box.type === 'mdat')
  const moov = boxes.find(box => box.type === 'moov')
  if (!mdat || !moov) return []

  const track = findVideoTrack(view, moov)
  if (!track) return []

  const durations = readDurations(view, track.timescale, track.durationsStart, track.durationsEnd)
  const samples: DashcamSample[] = []
  let cursor = mdat.start
  let frameIndex = 0
  let time = 0
  let pending: Omit<DashcamSample, 'time'> | null = null
  const fallback = durations[durations.length - 1] ?? (1 / 30)

  while (cursor + track.nalLength < mdat.end && frameIndex < 200000) {
    const nalSize = readNalLength(view, cursor, track.nalLength)
    cursor += track.nalLength
    if (nalSize < 1 || cursor + nalSize > mdat.end) break

    const nal = new Uint8Array(buffer, cursor, nalSize)
    const nalType = track.hevc ? (nal[0] >> 1) & 0x3f : nal[0] & 0x1f
    if (track.seiTypes.includes(nalType)) {
      pending = decodeSei(nal, track.headerLen) ?? pending
    } else if (isSlice(nalType, track.hevc)) {
      if (pending) samples.push({ time, ...pending })
      pending = null
      time += durations[frameIndex] ?? fallback
      frameIndex += 1
    }
    cursor += nalSize
  }
  // Pedal above 1 is percent. A 0-1 file stays a ratio.
  const pedalIsPercent = samples.some(sample => sample.accelerator > 1)
  if (pedalIsPercent) {
    for (const sample of samples) {
      sample.accelerator = Math.min(1, Math.max(0, sample.accelerator / 100))
    }
  }
  return samples
}

interface VideoTrack {
  hevc: boolean
  headerLen: number
  nalLength: number
  seiTypes: number[]
  timescale: number
  durationsStart: number
  durationsEnd: number
}

function findVideoTrack(view: DataView, moov: Box): VideoTrack | null {
  for (const trak of listBoxes(view, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue
    const mdia = childBox(view, trak, 'mdia')
    if (!mdia) continue
    const hdlr = childBox(view, mdia, 'hdlr')
    if (!hdlr || readAscii(view, hdlr.start + 8, 4) !== 'vide') continue
    const mdhd = childBox(view, mdia, 'mdhd')
    const minf = childBox(view, mdia, 'minf')
    const stbl = minf && childBox(view, minf, 'stbl')
    const stsd = stbl && childBox(view, stbl, 'stsd')
    const stts = stbl && childBox(view, stbl, 'stts')
    if (!mdhd || !stsd || !stts) continue

    const entries = listBoxes(view, stsd.start + 8, stsd.end)
    const entry = entries.find(box => box.type === 'avc1' || box.type === 'avc3' || box.type === 'hvc1' || box.type === 'hev1')
    if (!entry) continue
    const hevc = entry.type === 'hvc1' || entry.type === 'hev1'
    const version = view.getUint8(mdhd.start)
    const timescale = version === 1 ? view.getUint32(mdhd.start + 20) : view.getUint32(mdhd.start + 12)
    return {
      hevc,
      headerLen: hevc ? 2 : 1,
      nalLength: nalLengthOf(view, entry, hevc),
      seiTypes: hevc ? [39, 40] : [6],
      timescale: timescale > 0 ? timescale : 1,
      durationsStart: stts.start,
      durationsEnd: stts.end,
    }
  }
  return null
}

function nalLengthOf(view: DataView, entry: Box, hevc: boolean): number {
  const config = childBox(view, { ...entry, start: entry.start + 78 }, hevc ? 'hvcC' : 'avcC')
  if (!config) return 4
  const offset = hevc ? 21 : 4
  if (config.start + offset >= config.end) return 4
  return (view.getUint8(config.start + offset) & 0x3) + 1
}

function readDurations(view: DataView, timescale: number, start: number, end: number): number[] {
  const entryCount = view.getUint32(start + 4)
  const durations: number[] = []
  let pos = start + 8
  for (let i = 0; i < entryCount && pos + 8 <= end && durations.length < 200000; i++) {
    const count = view.getUint32(pos)
    const delta = view.getUint32(pos + 4)
    const seconds = delta / timescale
    const take = Math.min(count, 200000 - durations.length)
    for (let n = 0; n < take; n++) durations.push(seconds)
    pos += 8
  }
  return durations
}

function decodeSei(nal: Uint8Array, headerLen: number): Omit<DashcamSample, 'time'> | null {
  if (nal.length < headerLen + 3 || nal[headerLen] !== 5) return null
  let index = headerLen + 1
  while (index < nal.length) {
    const sizeByte = nal[index]
    index += 1
    if (sizeByte !== 0xff) break
  }
  const uuidStart = index
  while (index < nal.length && nal[index] === 0x42) index += 1
  if (index === uuidStart || index >= nal.length || nal[index] !== 0x69) return null
  return decodeProtobuf(stripEmulation(nal.subarray(index + 1, nal.length - 1)))
}

function decodeProtobuf(data: Uint8Array): Omit<DashcamSample, 'time'> | null {
  let gear = 0
  let speedMps = 0
  let accelerator = 0
  let steeringDeg = 0
  let brake = false
  let blinkerLeft = false
  let blinkerRight = false
  let autopilot = 0
  let seen = false
  let offset = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  while (offset < data.length) {
    const key = readVarint(data, offset)
    if (!key) return null
    const field = key.value >>> 3
    const wire = key.value & 7
    offset = key.offset
    if (wire === 0) {
      const body = readVarint(data, offset)
      if (!body) return null
      offset = body.offset
      seen = true
      if (field === 2) gear = body.value
      else if (field === 7) blinkerLeft = body.value !== 0
      else if (field === 8) blinkerRight = body.value !== 0
      else if (field === 9) brake = body.value !== 0
      else if (field === 10) autopilot = body.value
    } else if (wire === 5) {
      if (offset + 4 > data.length) return null
      const value = view.getFloat32(offset, true)
      offset += 4
      seen = true
      if (field === 4) speedMps = value
      else if (field === 5) accelerator = value
      else if (field === 6) steeringDeg = value
    } else if (wire === 1) {
      if (offset + 8 > data.length) return null
      offset += 8
      seen = true
    } else if (wire === 2) {
      const len = readVarint(data, offset)
      if (!len || offset + len.value > data.length) return null
      offset = len.offset + len.value
      seen = true
    } else {
      return null
    }
  }
  if (!seen || gear < 0 || gear > 3 || !Number.isFinite(speedMps)) return null
  return {
    gear: GEAR[gear],
    speedKmh: Math.max(0, Math.round(Math.abs(speedMps) * 3.6)),
    brake,
    accelerator: Number.isFinite(accelerator) ? accelerator : 0,
    autopilot: autopilot !== 0,
    steeringDeg: Number.isFinite(steeringDeg) ? steeringDeg : 0,
    blinkerLeft,
    blinkerRight,
  }
}

function stripEmulation(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let zeros = 0
  for (const byte of data) {
    if (zeros >= 2 && byte === 0x03) {
      zeros = 0
      continue
    }
    out.push(byte)
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return Uint8Array.from(out)
}

function readVarint(data: Uint8Array, offset: number): { value: number; offset: number } | null {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < data.length && shift <= 28) {
    const byte = data[cursor]
    cursor += 1
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset: cursor }
    shift += 7
  }
  while (cursor < data.length) {
    const byte = data[cursor]
    cursor += 1
    if ((byte & 0x80) === 0) return { value, offset: cursor }
  }
  return null
}

function isSlice(nalType: number, hevc: boolean): boolean {
  if (hevc) return nalType <= 9 || (nalType >= 16 && nalType <= 21)
  return nalType >= 1 && nalType <= 5
}

function readNalLength(view: DataView, offset: number, size: number): number {
  if (size === 4) return view.getUint32(offset)
  if (size === 3) return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2)
  if (size === 2) return view.getUint16(offset)
  return view.getUint8(offset)
}

function childBox(view: DataView, parent: Box | null, type: string): Box | null {
  if (!parent) return null
  return listBoxes(view, parent.start, parent.end).find(box => box.type === type) ?? null
}

function listBoxes(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let pos = start
  while (pos + 8 <= end) {
    let size = view.getUint32(pos)
    const type = readAscii(view, pos + 4, 4)
    let header = 8
    if (size === 1) {
      if (pos + 16 > end) break
      size = Number((BigInt(view.getUint32(pos + 8)) << 32n) | BigInt(view.getUint32(pos + 12)))
      header = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < header) break
    const next = pos + size
    if (next <= pos || next > end) break
    boxes.push({ type, start: pos + header, end: next })
    pos = next
  }
  return boxes
}

function readAscii(view: DataView, start: number, len: number): string {
  let text = ''
  for (let i = 0; i < len; i++) text += String.fromCharCode(view.getUint8(start + i))
  return text
}
